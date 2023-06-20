import { open as openHandle } from "fs/promises";
import { homedir } from "os";
import { join as pathJoin } from "path";
import LeakyBucket from "leaky-bucket";

import { stringify } from "csv-stringify/sync";
import { parse } from "csv-parse";

const initialIntervalSec = 300;

async function loadBookmarks() {
    const pattern = /^(https:\/\/[^\/]+\/)users\/[^\/]+\/statuses\/([0-9]+)$/;
    const bookmarks_path = pathJoin(homedir(), "Downloads/_takeout/bookmarks.csv");
    const handle = await openHandle(bookmarks_path);
    const readStream = handle.createReadStream();
    const bookmarks = readStream.pipe(parse());
    const bucketMap = new Map();
    const intervalMap = new Map();
    const outputPath = pathJoin(homedir(), "Downloads/_takeout/bookmarks_out.csv");
    const outputHandle = await openHandle(outputPath, "w");
    // const outputHandle = {write: function(x: any){}, close: function(){}};
    try {
        for await (const item of bookmarks) {
            const bookmark = item[0];
            const match = pattern.exec(bookmark);
            if (!match) {
                console.log("not mastodon:", bookmark);
                await outputHandle.write(stringify([[bookmark, ""]]));
                continue;
            }
            let [_, host, id] = [...match];
            console.log("mastodon:", host, id);
    
            if (!bucketMap.has(host)) {
                // Mastodon's default API limit is 300 calls per 5 minutes per IP. We will run at half of the rate. If running from shared IP address, may want to adjust the rate limit.
                bucketMap.set(host, new LeakyBucket({ capacity: 300/2, interval: initialIntervalSec, initialCapacity: 2, timeout: 30 }));
            }
    
            const bucket = bucketMap.get(host);
            await bucket.throttle();
    
            try {
                // query the original server for the toot
                // TODO abort the response if the server is not responding
                const response = await fetch(`${host}api/v1/statuses/${id}`);
                if (!response.ok) {
                    await outputHandle.write(stringify([[bookmark, ""]]));
                }
                const headers = response.headers;
                const data = await response.json();

                if (headers.has("X-RateLimit-Remaining")) {
                    let remaining = parseInt(headers.get("X-RateLimit-Remaining"));
                    // console.log("rate remaining:", remaining);
                    const bucket_excess = bucket.getCurrentCapacity() - remaining;
                    if (!isNaN(remaining) && (bucket_excess > 0)) {
                        console.log(`setting bucket level to ${remaining}`);
                        bucket.pay(bucket_excess);
                    }
                }
                if (headers.has("X-RateLimit-Limit")) {
                    let limit = parseInt(headers.get("X-RateLimit-Limit"));
                    // console.log("rate limit:", limit);
                    if (!isNaN(limit) && bucket.getCapacity() > limit) {
                        console.log(`setting bucket capacity to ${limit}`);
                        bucket.setCapacity(limit);
                    }
                }
                if (headers.has("X-RateLimit-Reset")) {
                    let reset = new Date(Date.parse(headers.get("X-RateLimit-Reset")));
                    let now = new Date();
                    let toResetSec = (reset.getTime() - now.getTime()) / 1000;
                    // console.log("reset:", reset);
                    // console.log("time until reset:", toResetSec);
                    let intervalSec = (intervalMap.has(host) ? intervalMap.get(host) : initialIntervalSec);
                    if (toResetSec > 0 && toResetSec < 3600 && toResetSec > intervalSec) {
                        console.log(`setting bucket interval to ${toResetSec}`);
                        bucket.setInterval(toResetSec);
                        intervalMap.set(host, toResetSec);
                    }
                }

                await outputHandle.write(stringify([[bookmark, data.content]]));
            } catch (e)
            {
                console.log(e);
                try {
                    // do our best attempt to write only the bookmark to output
                    await outputHandle.write(stringify([[bookmark, ""]]));
                } catch (e2)
                {
                    // if we can't even write the bookmark, move on
                    console.log(e2);
                }
            }
        }
    } catch (e)
    {
        // most likely there's trouble with the LeakyBucket
        // stop processing
        console.log(e);
    }
    outputHandle.close();
}

loadBookmarks();