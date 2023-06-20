
Downloads toots from a Mastodon bookmarks file.

Building
--------
Node.js 16+ is required for global.fetch and native ECMAScript module support for LeakyBucket.

```sh
npm install --global typescript
npm install
tsc
# or `tsc --watch` to run the TypeScript compiler whenever code changes
```

Running
-------
```sh
node dist/load-bookmarks.mjs
```

Caveats
-------
- Only works with Mastodon (will not work with Misskey, Pleroma, etc.)
- Makes unauthenticated queries (will not fetch private toots)
- Does few error checking
- Works with CSV export only (will not work with JSON bookmarks export)
- rate limit function is not well tested

License
-------
ISC