import * as cheerio from "cheerio";
import * as fs from "fs/promises";

const VERSION = "1.0.0";

/* vvv CONSTANTS vvv */

/**
 * The project to use. It must be a valid Wikimedia project hostname ({lang}.{project}.org).
 *
 * @type {string}
 */
const PROJECT = "en.wikipedia.org";
/**
 * The base map to use. It must have a path or group for each country, with the ID being the ISO 3166-1 alpha-2 code.
 *
 * @type {string}
 */
const BASE_MAP = "https://upload.wikimedia.org/wikipedia/commons/8/81/Detailed_Blank_World_Map.svg";
const COLOR_KEY = {
    "fa": "#9cbdff",
    "ga": "#66ff66",
    "b": "#b2ff66",
    "c": "#ffff66",
    "start": "#ffaa66",
    "stub": "#ffa4a4",
    "#default": "#cccccc"
};
/**
 * A list of countries which will be colored in based on the corresponding Wikipedia page.
 * If a country was detected on the map but not found in this list, a warning will appear.
 *
 * @type {Object.<string, string>}
 */
const COUNTRY_PAGE_OVERRIDES = {
    "xc": "Northern Cyprus",
    "xk": "Kosovo",
    "xs": "Somaliland"
};
/**
 * User agent to use. You should usually leave this alone.
 *
 * @type {string}
 */
const USER_AGENT = `world-map-by-article-quality/${VERSION} (wiki@chlod.net; [[User:Chlod]]; https://github.com/ChlodAlejandro/world-map-by-article-quality)`;
/* ^^^ CONSTANTS ^^^ */

(async () => {

    console.log(`world-map-by-article-quality v${VERSION}\n`);

    let i = 0;

    console.log(`${++i}. Downloading base map...`);
    console.log(`   - ${BASE_MAP}`)
    const baseMap = await fetch(BASE_MAP, {
        headers: {
            "User-Agent": USER_AGENT
        }
    }).then(response => response.text());
    console.log("   - Done!\n");

    console.log(`${++i}. Parsing base map...`);
    const $map = cheerio.load(baseMap, { xml: true });
    console.log("   - Done!\n");

    console.log(`${++i}. Identifying countries by code...`);
    const countryCodes =  [
        // All groups (usually archipelagos)
        ...$map("g"),
        // All paths
        ...$map("path")
    ]
        // Extract IDs
        .map((e) => $map(e).attr("id"))
        // Get only valid codes
        .filter(v => /^[a-z]{2}$/.test(v));
    const countryCount = countryCodes.length;
    console.log(`   - Found ${countryCount} potential countries...`);
    console.log("   - Done!\n");

    console.log(`${++i}. Getting pages for all countries...`);
    /** Key: country code, Value: country page */
    const countryPages = { ...COUNTRY_PAGE_OVERRIDES };
    const overriddenCodes = Object.keys(COUNTRY_PAGE_OVERRIDES).filter(code => countryCodes.includes(code));
    if (overriddenCodes.length > 0) {
        console.warn(`   - Overrides are being applied for ${overriddenCodes.length} countries found in the map:`);
        for (const code of overriddenCodes) {
            console.warn(`     - ${code} (${COUNTRY_PAGE_OVERRIDES[code]})`);
        }
    }
    const BATCH_COUNT = 50;
    const countryCodesCopy = [...countryCodes];
    let batchNo = 0;
    do {
        console.log(`   - Running batch ${++batchNo} (${Math.min(batchNo * BATCH_COUNT, countryCount)}/${countryCount})...`);
        const batch = countryCodesCopy.splice(0, BATCH_COUNT);
        const apiRequest = await fetch(`https://${PROJECT}/w/api.php`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": USER_AGENT
            },
            body: new URLSearchParams({
                action: "query",
                format: "json",
                titles: batch.map(v => `ISO 3166-1:${v.toUpperCase()}`).join("|"),
                redirects: 1,
                formatversion: "2"
            }).toString()
        }).then(r => r.json());
        const redirects = Object.fromEntries(apiRequest.query.redirects.map(r => [r.from, r.to]));
        const missingCodes = [];
        batch.forEach(code => {
            const redirectPage = `ISO 3166-1:${code.toUpperCase()}`;
            if (redirects[redirectPage]) {
                countryPages[code] = redirects[redirectPage];
            } else if (countryPages[code] == null) {
                // Only add to missingCodes if this code is not already in the list (not overridden).
                missingCodes.push(code);
            }
        });
        if (missingCodes.length > 0) {
            console.error(`     - Missing: ${missingCodes.join(", ")}`);
        }
    } while (countryCodesCopy.length > 0);
    const unknownCodes = countryCodes.filter(code => countryPages[code] == null);
    if (unknownCodes.length > 0) {
        console.error(`   - ${unknownCodes.length} countries were not found:`);
        console.error(`     - ${unknownCodes.join(", ")}`);
    }
    const countryCodeByPage = {};
    const duplicatedPages = {};
    // Check for duplicates
    for (const countryCode in countryPages) {
        if (countryCodeByPage[countryPages[countryCode]]) {
            // If this country has already been registered, add it to the duplicates list.
            duplicatedPages[countryPages[countryCode]] = [
                // Add every past country code encountered with the same page, or
                // add the country code that was previously registered with this page.
                ...(duplicatedPages[countryPages[countryCode]] || [countryCodeByPage[countryPages[countryCode]]]),
                countryCode
            ];
        } else {
            // No duplicates (yet). Register it.
            countryCodeByPage[countryPages[countryCode]] = countryCode;
        }
    }
    if (Object.keys(duplicatedPages).length > 0) {
        console.warn(`   - ${Object.keys(duplicatedPages).length} pages have multiple country codes associated with it:`);
        for (const page in duplicatedPages) {
            console.warn(`     - ${page}: ${duplicatedPages[page].join(", ")}`);
        }
    }
    console.log("   - Done!\n");

    console.log(`${++i}. Downloading talk pages for all countries...`);
    const talkXmlDump = await fetch("https://en.wikipedia.org/wiki/Special:Export", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": USER_AGENT
        },
        body: new URLSearchParams({
            title: "Special:Export",
            pages: Object.values(countryPages).map(v => `Talk:${v}`).join("\n"),
            curonly: 1
        })
    }).then(r => r.text());
    const $dump = cheerio.load(talkXmlDump, { xml: true });
    console.log("   - Done!\n");

    console.log(`${++i}. Parsing talk pages...`);
    const qualityRatings = {};
    $dump("page").each((_, page) => {
        const title = $dump(page).find("title").text();
        const countryCode = countryCodeByPage[title.replace(/^Talk:/, "")];
        const text = $dump(page).find("text").text();
        const ratingMatch = text.match(/(?<=\|\s*class\s*=\s*)(\w+)/);
        if (ratingMatch) {
            qualityRatings[countryCode] = ratingMatch[1].toLocaleLowerCase();
        } else {
            console.warn(`   - No rating detected for ${title} (${countryCode})`);
        }
    });
    for (const rating of new Set(Object.values(qualityRatings))) {
        if (COLOR_KEY[rating] == null) {
            console.warn(`   - Unknown rating detected: ${rating}`);
        }
    }
    console.log("   - Done!\n");

    console.log(`${++i}. Coloring countries...`);
    for (const countryCode of countryCodes) {
        const $country = $map(`#${countryCode}`);

        const color = COLOR_KEY[qualityRatings[countryCode] || "#default"] || COLOR_KEY["#default"];
        const style = `fill: ${color}; fill-opacity: 1`;
        $country.attr("style", style);
        $country.find("*:not(.limitxx)").attr("style", style);
    }
    console.log("   - Done!\n");

    console.log(`${++i}. Making map clickable...`);
    function xmlEscape(s) {
        return s
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
    }

    for (const countryCode in countryPages) {
        const countryPage = countryPages[countryCode];
        const url = `https://${PROJECT}/wiki/${encodeURIComponent(countryPage.replace(/ /g, "_"))}`;
        // noinspection JSCheckFunctionSignatures
        $map(`#${countryCode}`)
            .append(`<title>${xmlEscape(countryPage)}</title>`)
            .wrap(`<a href="${xmlEscape(url)}"></a>`);
    }
    console.log("   - Done!\n");

    console.log(`${++i}. Cleanup for SVG validity...`);
    console.log("   - Extracting nested <a> tags...");
    $map("a a").each( (i, e) => {
        // parent A
        const $aP = $map(e).parents("a");
        // Inherit translate first, if it has one.
        const transform = $aP.children("g, path").attr("transform");
        if (transform) {
            $map(e).children("g, path").attr("transform", transform);
        }
        // Move the child to become a sibling of $aP.
        $aP.after(e);
    });
    console.log("   - Done!\n");

    console.log(`${++i}. Attaching metadata...`);
    const $svg = $map("svg");
    console.log("   - Overwriting sodipodi docname...");
    $svg.attr("sodipodi:docname", "Detailed world map by English Wikipedia article quality.svg");
    console.log("   - Adding title...");
    // noinspection JSCheckFunctionSignatures
    $svg.prepend("<title>Detailed world map by English Wikipedia article quality</title>");
    console.log("   - Done!\n");

    console.log(`${++i}. Saving map...`);
    const output = $map.xml();
    await fs.writeFile("Detailed world map by English Wikipedia article quality.svg", output);
    console.log("   - Done!\n");

})();
