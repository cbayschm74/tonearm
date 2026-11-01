// Album art reaches a QML Image only as a LOCAL file the daemon fetched.
//
// Marketplace security review, 2026-10-31, against 0.14.1: "Panel.qml loads
// Model.artUrl() directly in Qt Image; Model.js constructs the configured Roon
// Core's plaintext HTTP image URL. An attacker controlling/spoofing that
// referenced Core response can exhaust shared-shell memory with an oversized
// body before decoding; sourceSize acts later, and the separate art helper's
// byte cap/tonearmd MemoryMax do not contain this shell-side fetch."
//
// So nothing in Model.js builds a Core URL any more. The daemon fetches every
// cover through art.py -- byte cap, header-checked dimensions, same-origin
// redirects -- and hands the widget a path inside its 0700 cache. These tests
// pin that the widget can only ever turn that into a file:// source.
const test = require("node:test")
const assert = require("node:assert")
const M = require("../Model.js")

const CORE = { host: "192.168.50.118", http_port: 9330, name: "yavin" }
const ART = "/run/user/1000/tonearm/art/a1b2.jpg"
const ROW_ART = "/run/user/1000/tonearm/rowart/48f5b5fe.jpg"

function playing(np) {
  return { v: 1, status: "ok", core: CORE, zones: [],
           zone: { id: "z1", state: "playing", now_playing: np } }
}

function isRemote(s) {
  return /^[a-z][a-z0-9+.-]*:/i.test(s) && String(s).indexOf("file://") !== 0
}

test("no Core URL builder is exported any more", () => {
  // artUrl/imageUrl/rowArtUrl were the http:// builders the review named.
  // Gone rather than unused, so nothing can wire one back into an Image.
  assert.strictEqual(M.artUrl, undefined)
  assert.strictEqual(M.imageUrl, undefined)
  assert.strictEqual(M.rowArtUrl, undefined)
})

test("artSource is the daemon's cached file, as a file:// URL", () => {
  assert.strictEqual(M.artSource(playing({ image_key: "a1b2", art_path: ART })),
                     "file://" + ART)
})

test("artSource is empty until the daemon has fetched the art", () => {
  // A Core and an image_key are exactly what 0.14.1 built an http:// URL
  // from. Without a local file there is nothing to show yet -- the muted
  // placeholder stays up -- and certainly nothing to fetch from the shell.
  assert.strictEqual(M.artSource(playing({ image_key: "a1b2" })), "")
  assert.strictEqual(M.artSource(playing({ image_key: "a1b2", art_path: null })), "")
})

test("artSource is empty when there is nothing playing", () => {
  assert.strictEqual(M.artSource(null), "")
  assert.strictEqual(M.artSource({ core: null, zone: null }), "")
  assert.strictEqual(M.artSource(playing(null)), "")
})

test("localArtSource refuses anything that is not a plain absolute path", () => {
  // art_path crosses a process boundary; whatever is not the shape art.py
  // writes is refused rather than handed to Image.source.
  const refused = [
    "http://192.168.50.118:9330/api/image/a1b2",
    "https://example.com/x.png",
    "file:///etc/passwd",
    "//evil/x.jpg",
    "relative/x.jpg",
    "/run/user/1000/tonearm/../../../etc/x.jpg",
    "/run/user/1000/tonearm/art/./x.jpg",
    "/run/user/1000/tonearm/art/x.jpg?width=99999",
    "/run/user/1000/tonearm/art/x.jpg#frag",
    "/run/user/1000/tonearm/art/x y.jpg",
    "/" + "a".repeat(5000),
    "", null, undefined, 42, {}, ["/x.jpg"]
  ]
  for (const value of refused) {
    assert.strictEqual(M.localArtSource(value), "", JSON.stringify(value))
  }
})

test("rowArtSource prefers the row's own art_path", () => {
  const row = { title: "Dead Man's Party", image_key: "48f5b5fe", art_path: ROW_ART }
  assert.strictEqual(M.rowArtSource(row, {}), "file://" + ROW_ART)
})

test("rowArtSource falls back to art learned from a later refresh", () => {
  const row = { title: "Dead Man's Party", image_key: "48f5b5fe" }
  assert.strictEqual(M.rowArtSource(row, { "48f5b5fe": ROW_ART }), "file://" + ROW_ART)
})

test("rowArtSource is empty for a row with no fetched art", () => {
  assert.strictEqual(M.rowArtSource({ image_key: "48f5b5fe" }, {}), "")
  assert.strictEqual(M.rowArtSource({ title: "Albums", image_key: null }, {}), "")
  assert.strictEqual(M.rowArtSource(null, {}), "")
  assert.strictEqual(M.rowArtSource({ image_key: "k" }, null), "")
})

test("rowArtSource does not walk the prototype for a hostile image_key", () => {
  // image_key is Core data used as a map key.
  assert.strictEqual(M.rowArtSource({ image_key: "__proto__" }, {}), "")
  assert.strictEqual(M.rowArtSource({ image_key: "constructor" }, {}), "")
})

test("mergeRowArt records only validated local paths, keyed by image_key", () => {
  const rows = [
    { image_key: "a", art_path: "/run/user/1000/tonearm/rowart/a.jpg" },
    { image_key: "b", art_path: "http://evil/b.jpg" },
    { image_key: "c" },
    { image_key: null, art_path: "/run/user/1000/tonearm/rowart/n.jpg" }
  ]
  const merged = M.mergeRowArt({ z: "/run/user/1000/tonearm/rowart/z.jpg" }, rows)
  assert.deepStrictEqual(Object.keys(merged).sort(), ["a", "z"])
})

test("mergeRowArt returns a new object so a QML binding re-evaluates", () => {
  const before = {}
  const after = M.mergeRowArt(before, [{ image_key: "a", art_path: ROW_ART }])
  assert.notStrictEqual(before, after)
  assert.deepStrictEqual(before, {})
})

test("mergeRowArt stays bounded", () => {
  let map = {}
  for (let i = 0; i < 40; i++) {
    const rows = []
    for (let j = 0; j < 100; j++) {
      rows.push({ image_key: "k" + i + "-" + j, art_path: "/r/k" + i + "-" + j + ".jpg" })
    }
    map = M.mergeRowArt(map, rows)
  }
  assert.ok(Object.keys(map).length <= M.MAX_ROW_ART, Object.keys(map).length)
})

test("rowArtPending is true only while a row with art has no local file yet", () => {
  assert.strictEqual(M.rowArtPending([{ image_key: "a" }], {}), true)
  assert.strictEqual(M.rowArtPending([{ image_key: "a", art_path: ROW_ART }], {}), false)
  assert.strictEqual(M.rowArtPending([{ image_key: "a" }], { a: ROW_ART }), false)
  assert.strictEqual(M.rowArtPending([{ image_key: null }], {}), false)
  assert.strictEqual(M.rowArtPending([], {}), false)
  assert.strictEqual(M.rowArtPending(null, {}), false)
})

test("no art-related export ever yields a remote URL", () => {
  // The property the review asked for, asserted across every export whose
  // name mentions art or image and every shape of input that 0.14.1 would
  // have turned into an http:// URL.
  const keys = ["a1b2", "a/b?c#d", "k&width=99999", "http://evil/x", "../../x"]
  const states = []
  for (const k of keys) {
    states.push(playing({ image_key: k }))
    states.push(playing({ image_key: k, art_path: "http://evil/" + k }))
    states.push(playing({ image_key: k, art_path: ART }))
  }
  const fns = Object.keys(M).filter(n => /art|image/i.test(n) && typeof M[n] === "function")
  assert.ok(fns.length >= 3, "found only " + fns)
  for (const name of fns) {
    for (const st of states) {
      const np = st.zone.now_playing
      for (const out of [M[name](st, 256), M[name](np, {}), M[name](np.art_path),
                         M[name](np, { [np.image_key]: np.art_path })]) {
        if (typeof out !== "string") continue
        assert.ok(!isRemote(out), name + " -> " + out)
      }
    }
  }
})
