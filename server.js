const express = require("express");
const path = require("path");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 4100;
const PASSCODE = process.env.TIMETRACKER_PASSWORD || "";

app.use(express.json());

// ---- Optional shared passcode gate --------------------------------------
// If TIMETRACKER_PASSWORD is set in the environment, every /api request
// must include a matching X-Passcode header. Leave it unset to run with
// no gate (fine on a private/internal network).
app.use("/api", (req, res, next) => {
  if (!PASSCODE) return next();
  if (req.path === "/passcode/check") return next();
  const supplied = req.get("X-Passcode") || "";
  if (supplied === PASSCODE) return next();
  return res.status(401).json({ error: "unauthorized" });
});

app.post("/api/passcode/check", (req, res) => {
  if (!PASSCODE) return res.json({ required: false, ok: true });
  const supplied = (req.body && req.body.passcode) || "";
  res.json({ required: true, ok: supplied === PASSCODE });
});

// ---- Clients --------------------------------------------------------------

app.get("/api/clients", (req, res) => {
  res.json(db.read().clients.sort((a, b) => a.name.localeCompare(b.name)));
});

app.post("/api/clients", (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "name is required" });
  const client = {
    id: db.newId(),
    name,
    archived: false,
    createdAt: Date.now(),
  };
  db.write((data) => data.clients.push(client));
  res.status(201).json(client);
});

app.patch("/api/clients/:id", (req, res) => {
  const { id } = req.params;
  let updated = null;
  db.write((data) => {
    const client = data.clients.find((c) => c.id === id);
    if (!client) return;
    if (typeof req.body.name === "string" && req.body.name.trim()) {
      client.name = req.body.name.trim();
    }
    if (typeof req.body.archived === "boolean") {
      client.archived = req.body.archived;
    }
    updated = client;
  });
  if (!updated) return res.status(404).json({ error: "not found" });
  res.json(updated);
});

app.delete("/api/clients/:id", (req, res) => {
  const { id } = req.params;
  const inUse = db.read().entries.some((e) => e.clientId === id);
  if (inUse) {
    return res.status(409).json({
      error: "client has time entries — archive it instead of deleting",
    });
  }
  let found = false;
  db.write((data) => {
    const before = data.clients.length;
    data.clients = data.clients.filter((c) => c.id !== id);
    found = data.clients.length < before;
  });
  if (!found) return res.status(404).json({ error: "not found" });
  res.status(204).end();
});

// ---- Employees --------------------------------------------------------------

app.get("/api/employees", (req, res) => {
  res.json(db.read().employees.sort((a, b) => a.name.localeCompare(b.name)));
});

app.post("/api/employees", (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "name is required" });
  const existing = db
    .read()
    .employees.find((e) => e.name.toLowerCase() === name.toLowerCase());
  if (existing) return res.json(existing);
  const employee = { id: db.newId(), name, createdAt: Date.now() };
  db.write((data) => data.employees.push(employee));
  res.status(201).json(employee);
});

// ---- Timer + entries --------------------------------------------------------

function activeEntryFor(employee) {
  return db
    .read()
    .entries.find((e) => e.employee === employee && e.endedAt == null);
}

app.get("/api/timer/active", (req, res) => {
  const employee = req.query.employee;
  if (!employee) return res.status(400).json({ error: "employee is required" });
  res.json(activeEntryFor(employee) || null);
});

app.post("/api/timer/start", (req, res) => {
  const { employee, clientId } = req.body;
  if (!employee || !clientId) {
    return res.status(400).json({ error: "employee and clientId are required" });
  }
  const client = db.read().clients.find((c) => c.id === clientId);
  if (!client) return res.status(404).json({ error: "client not found" });

  let entry = null;
  db.write((data) => {
    // Stop any timer already running for this employee first.
    const running = data.entries.find(
      (e) => e.employee === employee && e.endedAt == null
    );
    if (running) {
      running.endedAt = Date.now();
      running.durationSec = Math.max(
        0,
        Math.round((running.endedAt - running.startedAt) / 1000)
      );
    }
    entry = {
      id: db.newId(),
      employee,
      clientId,
      clientName: client.name,
      notes: "",
      startedAt: Date.now(),
      endedAt: null,
      durationSec: null,
    };
    data.entries.push(entry);
  });
  res.status(201).json(entry);
});

app.post("/api/timer/stop", (req, res) => {
  const { employee, notes } = req.body;
  if (!employee) return res.status(400).json({ error: "employee is required" });
  let entry = null;
  db.write((data) => {
    entry = data.entries.find(
      (e) => e.employee === employee && e.endedAt == null
    );
    if (!entry) return;
    entry.endedAt = Date.now();
    entry.durationSec = Math.max(
      0,
      Math.round((entry.endedAt - entry.startedAt) / 1000)
    );
    if (typeof notes === "string") entry.notes = notes;
  });
  if (!entry) return res.status(404).json({ error: "no running timer" });
  res.json(entry);
});

app.get("/api/entries", (req, res) => {
  const { employee, clientId, from, to } = req.query;
  let entries = db.read().entries;
  if (employee) entries = entries.filter((e) => e.employee === employee);
  if (clientId) entries = entries.filter((e) => e.clientId === clientId);
  if (from) entries = entries.filter((e) => e.startedAt >= Number(from));
  if (to) entries = entries.filter((e) => e.startedAt <= Number(to));
  entries = entries.slice().sort((a, b) => b.startedAt - a.startedAt);
  res.json(entries);
});

app.patch("/api/entries/:id", (req, res) => {
  const { id } = req.params;
  let updated = null;
  db.write((data) => {
    const entry = data.entries.find((e) => e.id === id);
    if (!entry) return;
    if (typeof req.body.notes === "string") entry.notes = req.body.notes;
    if (typeof req.body.startedAt === "number") entry.startedAt = req.body.startedAt;
    if (typeof req.body.endedAt === "number" || req.body.endedAt === null) {
      entry.endedAt = req.body.endedAt;
    }
    if (entry.endedAt != null) {
      entry.durationSec = Math.max(
        0,
        Math.round((entry.endedAt - entry.startedAt) / 1000)
      );
    }
    updated = entry;
  });
  if (!updated) return res.status(404).json({ error: "not found" });
  res.json(updated);
});

app.delete("/api/entries/:id", (req, res) => {
  const { id } = req.params;
  let found = false;
  db.write((data) => {
    const before = data.entries.length;
    data.entries = data.entries.filter((e) => e.id !== id);
    found = data.entries.length < before;
  });
  if (!found) return res.status(404).json({ error: "not found" });
  res.status(204).end();
});

// ---- Static frontend --------------------------------------------------------

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Ignite Time running at http://localhost:${PORT}`);
  if (PASSCODE) console.log("Passcode gate is ON.");
});
