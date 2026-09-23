// One-off helper: adds Ignite's real client list to an already-running
// instance without disturbing existing clients, employees, or entries.
// Run once from the Render Shell tab (or locally): node seed-clients.js
//
// Safe to re-run — it skips any client whose name already exists
// (case-insensitive), so it won't create duplicates.

const db = require("./db");

const CLIENTS = [
  "IGNITE",
  "MVI",
  "MC MS",
  "MMA",
  "MSH",
  "FSP",
  "MPS",
  "MPSCR",
  "JBK",
  "CHOICE/HA",
  "NRG",
  "PIPE RIGHT",
  "BELLE AND BOTTLE",
  "OneGenAway",
  "Pro - K9",
  "Renew Face & Laser",
  "Chris Howell Insurance",
  "Coaches and Clients",
  "Canterfield Senior Living",
  "HeronHill",
  "Local Air",
  "Mimi Miller Art",
  "Mason Chiropractic",
];

async function run() {
  const existing = db.read().clients.map((c) => c.name.toLowerCase());
  const toAdd = CLIENTS.filter((name) => !existing.includes(name.toLowerCase()));

  if (!toAdd.length) {
    console.log("Nothing to add — every client already exists.");
    return;
  }

  await db.write((data) => {
    const now = Date.now();
    toAdd.forEach((name, i) => {
      data.clients.push({
        id: db.newId(),
        name,
        archived: false,
        createdAt: now + i,
      });
    });
  });

  console.log(`Added ${toAdd.length} client(s):`);
  toAdd.forEach((name) => console.log(" -", name));
  if (toAdd.length < CLIENTS.length) {
    console.log(
      `(Skipped ${CLIENTS.length - toAdd.length} that already existed.)`
    );
  }
}

run().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
