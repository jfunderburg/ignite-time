// Minimal JSON-file datastore. No external DB required — everything
// lives in one file (data/db.json) so the whole app can be hosted
// anywhere Node runs, with no separate database to install or pay for.
//
// Writes are serialized through a single promise chain so concurrent
// requests never interleave and corrupt the file.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

function defaultData() {
  const now = Date.now();
  const seedClients = [
    "Canterfield Senior Living",
    "Local Air",
    "Holladay & Co",
    "Mississippi Plumbing Solutions",
    "The New Residents Guide",
    "OneGenAway",
    "Serenity",
    "Pipe Right Plumbing & Gas",
    "Mississippi Vein Institute",
    "MS Smart Homes",
    "CA Construction",
    "Internal / Ignite",
  ].map((name, i) => ({
    id: crypto.randomUUID(),
    name,
    archived: false,
    createdAt: now + i,
  }));

  const seedEmployees = [
    "Jack",
    "Katie Kronk",
    "Allie Grace Winter",
    "Raya Whitlock",
  ].map((name, i) => ({
    id: crypto.randomUUID(),
    name,
    createdAt: now + i,
  }));

  return { clients: seedClients, employees: seedEmployees, entries: [] };
}

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultData(), null, 2));
  }
}

ensureFile();

let cache = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
let writeChain = Promise.resolve();

function persist() {
  // Chain writes so two near-simultaneous requests can't clobber each other.
  writeChain = writeChain.then(
    () =>
      new Promise((resolve, reject) => {
        const tmp = DB_FILE + ".tmp";
        fs.writeFile(tmp, JSON.stringify(cache, null, 2), (err) => {
          if (err) return reject(err);
          fs.rename(tmp, DB_FILE, (err2) => (err2 ? reject(err2) : resolve()));
        });
      })
  );
  return writeChain;
}

module.exports = {
  read() {
    return cache;
  },
  async write(mutator) {
    // mutator receives the in-memory data and mutates it in place
    mutator(cache);
    await persist();
    return cache;
  },
  newId() {
    return crypto.randomUUID();
  },
};
