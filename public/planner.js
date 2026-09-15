import { icon } from "/icons.js";
import { celebrate } from "/celebration.js";
import {
  itemEvents,
  eventLink,
  addDays,
  spending,
  csvExport,
  parseCalendar,
} from "./organize.js";
import { today, daysAway } from "./logic.js";
const $ = (s) => document.querySelector(s);
function node(tag, className = "", text = "") {
  const n = document.createElement(tag);
  n.className = className;
  n.textContent = text;
  return n;
}
function button(text, action, className = "secondary") {
  const b = node("button", className, text);
  b.type = "button";
  b.onclick = action;
  return b;
}
export function createPlanner({
  getPurchases,
  getExternalEvents = () => [],
  getSources = () => [],
  save,
  edit,
  exportCalendar,
  download,
  toast,
  create,
}) {
  let month = today().slice(0, 7),
    selected = "",
    filter = "upcoming",
    imported = [];
  const apply = async (p, change) => {
    try {
      await save({ ...p, ...change }, p._version || 0);
      toast("Reminder updated.");
      return true;
    } catch (error) {
      toast(error.message);
    }
  };
  function render() {
    if ($("#planner-workspace").hidden && $("#insights-workspace").hidden)
      return;
    const purchases = getPurchases();
    const connected = getSources();
    $("#connected-calendars-summary").textContent = connected.length ? `${connected.length} connected calendar${connected.length === 1 ? "" : "s"} · ${getExternalEvents().length} calendar events${connected.some(source => source.error) ? " · A calendar needs attention; open Connect calendar." : ""}` : "Connect Google, Outlook or iCloud calendars to bring their events into this view.";
    const picker = $("#calendar-source-filter"), chosen = picker.value;
    picker.replaceChildren(new Option("All calendars", "all"), new Option("Tuckday reminders", "tuckday"), ...getSources().map(source => new Option(source.name, source.id)));
    picker.value = [...picker.options].some(option => option.value === chosen) ? chosen : "all";
    const events = [...itemEvents(purchases, { includeCompleted: true }), ...getExternalEvents()].filter(event => picker.value === "all" || (picker.value === "tuckday" ? !event.external : event.sourceId === picker.value)).sort((a,b) => a.date.localeCompare(b.date) || (a.sort || a.date).localeCompare(b.sort || b.date));
    const start = new Date(month + "-01T12:00:00"),
      first = new Date(start);
    first.setDate(1 - ((start.getDay() + 6) % 7));
    $("#month-title").textContent = start.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
    const grid = $("#month-grid");
    grid.replaceChildren();
    for (let i = 0; i < 42; i++) {
      const date = new Date(first);
      date.setDate(first.getDate() + i);
      const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const count = events.filter((e) => !e.completed && e.date <= iso && (e.endDate || e.date) >= iso).length;
      const day = button(
        "",
        () => {
          selected = selected === iso ? "" : iso;
          filter = "all";
          $("#agenda-filter").value = "all";
          render();
        },
        "month-day",
      );
      day.dataset.outside = String(!iso.startsWith(month));
      day.setAttribute("aria-pressed", String(selected === iso));
      day.setAttribute(
        "aria-label",
        `${date.toLocaleDateString(undefined, { dateStyle: "full" })}, ${count} reminders`,
      );
      if (iso === today()) day.setAttribute("aria-current", "date");
      day.append(node("span", "", String(date.getDate())));
      if (count) day.append(node("small", "day-dot", String(count)));
      grid.append(day);
    }
    $("#clear-day").hidden = !selected;
    $("#agenda-title").textContent = selected
      ? `On ${new Date(selected + "T12:00:00").toLocaleDateString(undefined, { dateStyle: "long" })}`
      : "Your agenda";
    const visible = events.filter(
      (e) =>
        (!selected || (e.date <= selected && (e.endDate || e.date) >= selected)) &&
        (filter === "completed"
          ? e.completed
          : !e.completed &&
            (filter === "all" ||
              (filter === "overdue"
                ? daysAway(e.endDate || e.date) < 0
                : daysAway(e.endDate || e.date) >= 0))),
    );
    const list = $("#agenda-list");
    list.replaceChildren();
    if (!visible.length) {
      const empty = node("div", "planner-empty");
      const cleared =
        events.length > 0 &&
        events.every((event) => event.completed) &&
        filter !== "completed";
      if (cleared) {
        const stamp = node("div", "all-clear-stamp");
        stamp.append(icon("check"), node("strong", "", "ALL CLEAR"));
        empty.append(stamp);
      }
      empty.append(
        node(
          "h3",
          "",
          cleared ? "Everything checked off." : "No dates in this view.",
        ),
        node(
          "p",
          "",
          cleared
            ? `${events.length} reminder${events.length === 1 ? "" : "s"} completed. You can find them in the Completed view.`
            : "No reminders in this view. Add a date to an item, or choose another day.",
        ),
      );
      list.append(empty);
    }
    for (const event of visible.slice(0, 100)) {
      const row = node("article", "agenda-event"),
        head = node("div", "agenda-event-head");
      head.append(
        node(
          "span",
          "agenda-date",
          new Date(event.date + "T12:00:00").toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          }),
        ),
        node("h3", "", event.p.item),
      );
      row.append(
        head,
        node(
          "p",
          "",
          `${event.label}${event.completed ? " · Completed" : !event.external && daysAway(event.date) < 0 ? " · Overdue" : ""}`,
        ),
      );
      if (event.external) {
        row.classList.add("external-event");
        row.append(node("span", "source-badge", event.sourceName));
        if(event.location) row.append(node("p", "", event.location));
        row.append(node("p", "fine-print", "From your connected calendar · Edit in its original app"));
        list.append(row);
        continue;
      }
      const actions = node("div", "agenda-actions");
      actions.append(
        button("Edit", () => edit(event.p)),
        button(event.completed ? "Reopen" : "Mark done", async (click) => {
          const completed = { ...event.p.completed };
          if (event.completed) delete completed[event.key];
          else completed[event.key] = event.date;
          const box = click.currentTarget.getBoundingClientRect();
          const ok = await apply(event.p, { completed });
          if (ok && !event.completed)
            celebrate({ x: box.x + box.width / 2, y: box.y });
        }),
      );
      if (!event.completed) {
        actions.append(
          button("Snooze 7 days", () =>
            apply(event.p, {
              [event.key]: addDays(
                event.date < today() ? today() : event.date,
                7,
              ),
            }),
          ),
        );
        for (const [provider, label] of [
          ["google", "Google Calendar"],
          ["outlook", "Outlook"],
        ]) {
          const link = node("a", "secondary", label);
          link.href = eventLink(event, provider);
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          actions.append(link);
        }
        actions.append(
          button("Apple / .ics", () => {
            const single = { ...event.p };
            for (const key of [
              "return",
              "cancel",
              "warranty",
              "price",
              "reminder",
            ])
              if (key !== event.key) single[key] = "";
            exportCalendar([single]);
          }),
        );
      }
      row.append(actions);
      list.append(row);
    }
    $("#agenda-limit").textContent =
      visible.length > 100
        ? `Showing 100 of ${visible.length}. Select a day to narrow the list.`
        : `${visible.length} event${visible.length === 1 ? "" : "s"} across the selected calendars.`;
    const totals = $("#spending-summary");
    totals.replaceChildren();
    const groups = spending(purchases);
    if (!groups.length)
      totals.append(
        node(
          "p",
          "muted",
          "Add amounts to your items to see your spending here.",
        ),
      );
    const currencies = [...new Set(groups.map((g) => g.currency))];
    for (const currency of currencies) {
      const rows = groups.filter((g) => g.currency === currency),
        sum = rows.reduce((n, g) => n + g.amount, 0),
        card = node("article", "insight-card");
      card.append(
        node("span", "eyebrow", currency),
        node(
          "h3",
          "",
          new Intl.NumberFormat(undefined, {
            style: "currency",
            currency,
          }).format(sum),
        ),
      );
      for (const group of rows) {
        const line = node("div", "spending-row");
        line.append(
          node("span", "", `${group.category} · ${group.count}`),
          node(
            "strong",
            "",
            new Intl.NumberFormat(undefined, {
              style: "currency",
              currency,
            }).format(group.amount),
          ),
        );
        card.append(line);
      }
      totals.append(card);
    }
  }
  $("#month-prev").onclick = () => {
    const d = new Date(month + "-01T12:00:00");
    d.setMonth(d.getMonth() - 1);
    month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    selected = "";
    render();
  };
  $("#month-next").onclick = () => {
    const d = new Date(month + "-01T12:00:00");
    d.setMonth(d.getMonth() + 1);
    month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    selected = "";
    render();
  };
  $("#month-today").onclick = () => {
    month = today().slice(0, 7);
    selected = today();
    filter = "all";
    $("#agenda-filter").value = "all";
    render();
  };
  $("#clear-day").onclick = () => {
    selected = "";
    render();
  };
  $("#agenda-filter").onchange = (e) => {
    filter = e.target.value;
    render();
  };
  $("#export-csv").onclick = () =>
    download(
      csvExport(getPurchases()),
      "text/csv;charset=utf-8",
      "returnradar-items.csv",
    );
  $("#planner-export").onclick = () => exportCalendar(getPurchases());
  $("#calendar-import").onchange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 1000000)
        throw Error("Use a calendar file smaller than 1 MB.");
      const result = parseCalendar(await file.text());
      imported = result.events.map((event) => ({
        ...event,
        id: crypto.randomUUID(),
      }));
      const list = $("#calendar-import-preview");
      list.replaceChildren();
      imported.forEach((e, i) => {
        const label = node("label", "import-event");
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = !getPurchases().some(
          (p) => p.item === e.title && p.reminder === e.date,
        );
        check.dataset.index = i;
        label.append(check, node("span", "", `${e.title} · ${e.date}`));
        list.append(label);
      });
      $("#calendar-import-status").textContent =
        `${imported.length} all-day events ready to review. ${result.skipped} timed, recurring or invalid events skipped. Originals are not changed.`;
      $("#confirm-calendar-import").disabled = !imported.length;
      $("#calendar-import-dialog").showModal();
    } catch (error) {
      toast(error.message);
    } finally {
      event.target.value = "";
    }
  };
  $("#close-calendar-import").onclick = () =>
    $("#calendar-import-dialog").close();
  $("#confirm-calendar-import").onclick = async () => {
    const checks = [
      ...$("#calendar-import-preview").querySelectorAll("input:checked"),
    ];
    let count = 0;
    $("#confirm-calendar-import").disabled = true;
    try {
      for (const check of checks) {
        const event = imported[Number(check.dataset.index)];
        await create(event);
        check.checked = false;
        check.disabled = true;
        count++;
      }
      $("#calendar-import-dialog").close();
      toast(`${count} reminders imported.`);
    } catch (error) {
      $("#calendar-import-status").textContent =
        `${count} imported. ${error.message} Confirmed events are unchecked so retry will not repeat them.`;
    } finally {
      $("#confirm-calendar-import").disabled = false;
    }
  };
  $("#calendar-source-filter").onchange = render;
  return { render };
}
