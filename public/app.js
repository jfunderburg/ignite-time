(() => {
  "use strict";

  const state = {
    passcode: localStorage.getItem("ignite-time-passcode") || "",
    employee: localStorage.getItem("ignite-time-employee") || "",
    clients: [],
    employees: [],
    entries: [],
    active: null, // currently running entry for the selected employee
    notesDebounce: null,
  };

  const el = (id) => document.getElementById(id);

  // ---- API helper -----------------------------------------------------------

  async function api(path, options = {}) {
    const headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
    if (state.passcode) headers["X-Passcode"] = state.passcode;
    const res = await fetch("/api" + path, Object.assign({}, options, { headers }));
    if (res.status === 401) {
      showPasscodeScreen(true);
      throw new Error("unauthorized");
    }
    if (res.status === 204) return null;
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error((body && body.error) || res.statusText);
    return body;
  }

  // ---- Passcode gate ----------------------------------------------------------

  function showPasscodeScreen(isError) {
    el("app").classList.add("hidden");
    el("passcode-screen").classList.remove("hidden");
    el("passcode-error").classList.toggle("hidden", !isError);
  }

  async function boot() {
    const check = await fetch("/api/passcode/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode: state.passcode }),
    }).then((r) => r.json());

    if (check.required && !check.ok) {
      showPasscodeScreen(false);
      return;
    }
    el("passcode-screen").classList.add("hidden");
    el("app").classList.remove("hidden");
    await initApp();
  }

  el("passcode-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = el("passcode-input").value;
    const check = await fetch("/api/passcode/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode: value }),
    }).then((r) => r.json());
    if (check.ok) {
      state.passcode = value;
      localStorage.setItem("ignite-time-passcode", value);
      el("passcode-screen").classList.add("hidden");
      el("app").classList.remove("hidden");
      initApp();
    } else {
      el("passcode-error").classList.remove("hidden");
    }
  });

  // ---- Init ---------------------------------------------------------------

  async function initApp() {
    await Promise.all([loadEmployees(), loadClients()]);
    if (!state.employee && state.employees.length) {
      state.employee = state.employees[0].name;
    }
    renderEmployeeSelect();
    await refreshActive();
    await loadEntries();
    renderClientGrid();
    renderHistory();
    tickTimer();
    setInterval(tickTimer, 1000);
    setInterval(refreshActive, 8000);
    setInterval(loadEntries, 25000);
  }

  // ---- Employees ----------------------------------------------------------

  async function loadEmployees() {
    state.employees = await api("/employees");
  }

  function renderEmployeeSelect() {
    const select = el("employee-select");
    select.innerHTML = "";
    state.employees.forEach((emp) => {
      const opt = document.createElement("option");
      opt.value = emp.name;
      opt.textContent = emp.name;
      if (emp.name === state.employee) opt.selected = true;
      select.appendChild(opt);
    });

    const filterSelect = el("filter-employee");
    const currentFilter = filterSelect.value;
    filterSelect.innerHTML = '<option value="">Everyone</option>';
    state.employees.forEach((emp) => {
      const opt = document.createElement("option");
      opt.value = emp.name;
      opt.textContent = emp.name;
      filterSelect.appendChild(opt);
    });
    filterSelect.value = currentFilter;
  }

  el("employee-select").addEventListener("change", async (e) => {
    state.employee = e.target.value;
    localStorage.setItem("ignite-time-employee", state.employee);
    await refreshActive();
    renderClientGrid();
    tickTimer();
  });

  el("add-employee-btn").addEventListener("click", async () => {
    const name = prompt("Teammate's name:");
    if (!name || !name.trim()) return;
    const emp = await api("/employees", {
      method: "POST",
      body: JSON.stringify({ name: name.trim() }),
    });
    await loadEmployees();
    state.employee = emp.name;
    localStorage.setItem("ignite-time-employee", state.employee);
    renderEmployeeSelect();
    await refreshActive();
    renderClientGrid();
  });

  // ---- Clients --------------------------------------------------------------

  async function loadClients() {
    state.clients = await api("/clients");
  }

  function renderClientGrid() {
    const grid = el("client-grid");
    grid.innerHTML = "";
    const active = state.clients.filter((c) => !c.archived);

    if (!active.length) {
      grid.innerHTML = '<p class="client-empty">No clients yet — add your first one above.</p>';
      return;
    }

    active.forEach((client) => {
      const card = document.createElement("div");
      const isRunning = state.active && state.active.clientId === client.id;
      card.className = "client-card" + (isRunning ? " is-running" : "");
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.innerHTML = `
        <span class="client-card-name">${escapeHtml(client.name)}</span>
        <span class="client-card-hint">${isRunning ? "Timer running — click to stop" : "Click to start timer"}</span>
        <button type="button" class="client-archive-btn" title="Archive this client">archive</button>
      `;
      card.addEventListener("click", (e) => {
        if (e.target.closest(".client-archive-btn")) return;
        onClientClick(client);
      });
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClientClick(client);
        }
      });
      card.querySelector(".client-archive-btn").addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`Archive ${client.name}? It'll disappear from this grid, but its logged time stays in history. You can\u2019t un-archive from here \u2014 ask me if you need one back.`)) return;
        await api("/clients/" + client.id, {
          method: "PATCH",
          body: JSON.stringify({ archived: true }),
        });
        await loadClients();
        renderClientGrid();
      });
      grid.appendChild(card);
    });
  }

  async function onClientClick(client) {
    if (!state.employee) {
      alert("Pick who you are first (top right).");
      return;
    }
    if (state.active && state.active.clientId === client.id) {
      await stopTimer();
      return;
    }
    state.active = await api("/timer/start", {
      method: "POST",
      body: JSON.stringify({ employee: state.employee, clientId: client.id }),
    });
    el("active-notes").value = "";
    renderClientGrid();
    renderActiveBar();
    await loadEntries();
    renderHistory();
  }

  el("add-client-btn").addEventListener("click", async () => {
    const name = prompt("New client name:");
    if (!name || !name.trim()) return;
    await api("/clients", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
    await loadClients();
    renderClientGrid();
  });

  // ---- Active timer -----------------------------------------------------------

  async function refreshActive() {
    if (!state.employee) {
      state.active = null;
    } else {
      state.active = await api("/timer/active?employee=" + encodeURIComponent(state.employee));
    }
    renderActiveBar();
    renderClientGrid();
  }

  function renderActiveBar() {
    const bar = el("active-bar");
    if (!state.active) {
      bar.classList.add("hidden");
      return;
    }
    bar.classList.remove("hidden");
    el("active-client-name").textContent = state.active.clientName;
    el("active-since").textContent =
      "Started " + new Date(state.active.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (document.activeElement !== el("active-notes")) {
      el("active-notes").value = state.active.notes || "";
    }
  }

  function tickTimer() {
    if (!state.active) return;
    const seconds = Math.max(0, Math.floor((Date.now() - state.active.startedAt) / 1000));
    el("active-timer").textContent = formatHMS(seconds);
  }

  el("active-notes").addEventListener("input", (e) => {
    if (!state.active) return;
    const value = e.target.value;
    clearTimeout(state.notesDebounce);
    state.notesDebounce = setTimeout(async () => {
      try {
        await api("/entries/" + state.active.id, {
          method: "PATCH",
          body: JSON.stringify({ notes: value }),
        });
        state.active.notes = value;
      } catch (err) {
        /* transient — next debounce or stop will retry */
      }
    }, 500);
  });

  async function stopTimer() {
    if (!state.employee) return;
    const notes = el("active-notes").value;
    await api("/timer/stop", {
      method: "POST",
      body: JSON.stringify({ employee: state.employee, notes }),
    });
    state.active = null;
    renderActiveBar();
    renderClientGrid();
    await loadEntries();
    renderHistory();
  }

  el("stop-btn").addEventListener("click", stopTimer);

  // ---- History + summary --------------------------------------------------

  async function loadEntries() {
    state.entries = await api("/entries");
    renderHistory();
  }

  function rangeStartMs(range) {
    const now = new Date();
    if (range === "week") {
      const day = (now.getDay() + 6) % 7; // Monday = 0
      const monday = new Date(now);
      monday.setHours(0, 0, 0, 0);
      monday.setDate(now.getDate() - day);
      return monday.getTime();
    }
    if (range === "month") {
      return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    }
    return 0;
  }

  function filteredEntries() {
    const empFilter = el("filter-employee").value;
    const range = el("filter-range").value;
    const since = rangeStartMs(range);
    return state.entries.filter((e) => {
      if (empFilter && e.employee !== empFilter) return false;
      if (e.startedAt < since) return false;
      return true;
    });
  }

  function renderHistory() {
    const entries = filteredEntries();

    // Summary pills: total time per client for the filtered set.
    const totals = new Map();
    entries.forEach((e) => {
      const dur = e.endedAt ? e.durationSec : Math.floor((Date.now() - e.startedAt) / 1000);
      totals.set(e.clientName, (totals.get(e.clientName) || 0) + dur);
    });
    const summaryRow = el("summary-row");
    summaryRow.innerHTML = "";
    [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .forEach(([name, secs]) => {
        const pill = document.createElement("div");
        pill.className = "summary-pill";
        pill.innerHTML = `<span>${escapeHtml(name)}</span><span class="amount">${formatHM(secs)}</span>`;
        summaryRow.appendChild(pill);
      });

    const body = el("entries-body");
    body.innerHTML = "";
    el("entries-empty").classList.toggle("hidden", entries.length > 0);

    entries.forEach((e) => {
      const tr = document.createElement("tr");
      if (!e.endedAt) tr.classList.add("row-running");
      const dur = e.endedAt ? e.durationSec : Math.floor((Date.now() - e.startedAt) / 1000);
      const dateStr = new Date(e.startedAt).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      tr.innerHTML = `
        <td data-label="Client">${escapeHtml(e.clientName)}</td>
        <td data-label="Employee">${escapeHtml(e.employee)}</td>
        <td data-label="Date">${dateStr}</td>
        <td data-label="Duration">${e.endedAt ? formatHM(dur) : '<span class="tag-running">running…</span>'}</td>
        <td data-label="Notes" class="notes-cell">${escapeHtml(e.notes || "—")}</td>
        <td data-label=""><button class="delete-entry" data-id="${e.id}">delete</button></td>
      `;
      body.appendChild(tr);
    });

    body.querySelectorAll(".delete-entry").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this time entry? This can't be undone.")) return;
        await api("/entries/" + btn.dataset.id, { method: "DELETE" });
        await loadEntries();
        await refreshActive();
      });
    });
  }

  el("filter-employee").addEventListener("change", renderHistory);
  el("filter-range").addEventListener("change", renderHistory);

  // ---- Manual entry modal ---------------------------------------------------

  function populateManualSelects() {
    const empSelect = el("manual-employee");
    empSelect.innerHTML = "";
    state.employees.forEach((emp) => {
      const opt = document.createElement("option");
      opt.value = emp.name;
      opt.textContent = emp.name;
      if (emp.name === state.employee) opt.selected = true;
      empSelect.appendChild(opt);
    });

    const clientSelect = el("manual-client");
    clientSelect.innerHTML = "";
    state.clients
      .filter((c) => !c.archived)
      .forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = c.name;
        clientSelect.appendChild(opt);
      });
  }

  function openManualEntryModal() {
    populateManualSelects();
    const now = new Date();
    el("manual-date").value = now.toISOString().slice(0, 10);
    el("manual-start").value = "";
    el("manual-end").value = "";
    el("manual-notes").value = "";
    el("manual-entry-error").classList.add("hidden");
    el("manual-entry-overlay").classList.remove("hidden");
  }

  function closeManualEntryModal() {
    el("manual-entry-overlay").classList.add("hidden");
  }

  el("add-entry-btn").addEventListener("click", openManualEntryModal);
  el("manual-entry-cancel").addEventListener("click", closeManualEntryModal);
  el("manual-entry-overlay").addEventListener("click", (e) => {
    if (e.target.id === "manual-entry-overlay") closeManualEntryModal();
  });

  el("manual-entry-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = el("manual-entry-error");
    errorEl.classList.add("hidden");

    const date = el("manual-date").value;
    const startTime = el("manual-start").value;
    const endTime = el("manual-end").value;
    if (!date || !startTime || !endTime) return;

    const startedAt = new Date(`${date}T${startTime}`).getTime();
    let endedAt = new Date(`${date}T${endTime}`).getTime();
    // If end time is earlier than start time, assume it rolled past midnight.
    if (endedAt <= startedAt) endedAt += 24 * 60 * 60 * 1000;

    try {
      await api("/entries", {
        method: "POST",
        body: JSON.stringify({
          employee: el("manual-employee").value,
          clientId: el("manual-client").value,
          startedAt,
          endedAt,
          notes: el("manual-notes").value,
        }),
      });
      closeManualEntryModal();
      await loadEntries();
    } catch (err) {
      errorEl.textContent = err.message || "Couldn't save that entry.";
      errorEl.classList.remove("hidden");
    }
  });

  // ---- Utils ----------------------------------------------------------------

  function formatHMS(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
  }

  function formatHM(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  boot();
})();
