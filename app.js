import { firebaseConfig, allowedEmail } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const configured = !firebaseConfig.apiKey.startsWith("ISI_");

// ---------- Util ----------
const todayStr = () => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
};
const formatDate = (s) => {
  if (!s) return "Tanpa tanggal";
  const d = new Date(s + "T00:00:00");
  return d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
};
let toastTimer;
const showError = (msg) => {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 5000);
};
const run = async (fn) => {
  try { await fn(); }
  catch (e) { console.error(e); showError("Gagal menyimpan ke Firebase: " + (e.code || e.message)); }
};

// ---------- Navbar / routing ----------
const routes = ["tugas", "catatan"];
function renderRoute() {
  const hash = location.hash.replace("#/", "");
  const route = routes.includes(hash) ? hash : "tugas";
  routes.forEach((r) => {
    $("page-" + r).hidden = r !== route;
    const tab = document.querySelector(`.tab[data-route="${r}"]`);
    tab.classList.toggle("active", r === route);
    if (r === route) tab.setAttribute("aria-current", "page"); else tab.removeAttribute("aria-current");
  });
}
window.addEventListener("hashchange", renderRoute);
renderRoute();

$("todoDate").value = todayStr();
$("noteDate").value = todayStr();

// ---------- Tampilan login / aplikasi ----------
function showLogin(message) {
  $("appShell").hidden = true;
  $("loginScreen").hidden = false;
  $("loginBtn").disabled = !configured;
  const msg = $("loginMsg");
  msg.hidden = !message;
  msg.textContent = message || "";
}
function showApp(user) {
  $("loginScreen").hidden = true;
  $("appShell").hidden = false;
  $("userEmail").textContent = user.email;
  renderRoute();
}

if (!configured) {
  $("configBanner").hidden = false;
  showLogin();
} else {
  init();
}

function init() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const todosCol = collection(db, "todos");
  const notesCol = collection(db, "notes");

  const isAllowed = (user) =>
    !allowedEmail || (user.email || "").toLowerCase() === allowedEmail.toLowerCase();

  // ---------- Login / logout ----------
  $("loginBtn").addEventListener("click", async () => {
    pendingLoginMessage = "";
    $("loginMsg").hidden = true;
    $("loginBtn").disabled = true;
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
      console.error(e);
      if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
        const hint = e.code === "auth/unauthorized-domain"
          ? "Domain ini belum didaftarkan di Firebase (Authentication → Settings → Authorized domains)."
          : "Gagal masuk: " + (e.code || e.message);
        showLogin(hint);
      }
    }
    $("loginBtn").disabled = false;
  });
  $("logoutBtn").addEventListener("click", () => signOut(auth));

  let unsubTodos = null;
  let unsubNotes = null;
  // Pesan ini disimpan karena signOut() memicu callback kedua (user = null)
  // yang sebelumnya menghapus pesan sebelum sempat terbaca.
  let pendingLoginMessage = "";

  onAuthStateChanged(auth, (user) => {
    if (user && isAllowed(user)) {
      pendingLoginMessage = "";
      showApp(user);
      startListeners();
    } else if (user) {
      stopListeners();
      pendingLoginMessage = `Akun ${user.email} tidak punya akses ke aplikasi ini. Masuk dengan akun yang diizinkan.`;
      showLogin(pendingLoginMessage);
      showError("Akses ditolak: " + user.email);
      signOut(auth);
    } else {
      stopListeners();
      showLogin(pendingLoginMessage);
    }
  });

  function startListeners() {
    stopListeners();
    unsubTodos = onSnapshot(query(todosCol, orderBy("tanggal", "asc")),
      (snap) => { todos = snap.docs.map((d) => ({ id: d.id, ...d.data() })); renderTodos(); },
      (err) => showError("Gagal memuat tugas: " + err.code));
    unsubNotes = onSnapshot(query(notesCol, orderBy("tanggal", "desc")),
      (snap) => { notes = snap.docs.map((d) => ({ id: d.id, ...d.data() })); renderNotes(); },
      (err) => showError("Gagal memuat catatan: " + err.code));
  }
  function stopListeners() {
    if (unsubTodos) unsubTodos();
    if (unsubNotes) unsubNotes();
    unsubTodos = unsubNotes = null;
    todos = []; notes = [];
    renderTodos(); renderNotes();
    resetTodoForm(); resetNoteForm();
  }

  // ============================================================
  //  TO-DO
  // ============================================================
  let todos = [];
  let todoFilter = "active";
  let editingTodo = null;

  function buildTodoItem(t, today) {
    const late = !t.done && t.tanggal && t.tanggal < today;
    const li = document.createElement("li");
    li.className = "item" + (t.done ? " done" : "") + (late ? " overdue" : "");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!t.done;
    cb.setAttribute("aria-label", "Tandai selesai: " + t.title);
    cb.addEventListener("change", () => run(() => updateDoc(doc(db, "todos", t.id), { done: cb.checked })));

    const body = document.createElement("div");
    body.className = "body";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = t.title;
    body.append(title);

    const actions = document.createElement("div");
    actions.className = "item-actions";
    const edit = document.createElement("button");
    edit.className = "btn-text"; edit.textContent = "Ubah";
    edit.addEventListener("click", () => startEditTodo(t));
    const del = document.createElement("button");
    del.className = "btn-text danger"; del.textContent = "Hapus";
    del.addEventListener("click", () => {
      if (confirm("Hapus tugas ini?")) run(() => deleteDoc(doc(db, "todos", t.id)));
    });
    actions.append(edit, del);

    li.append(cb, body, actions);
    return li;
  }

  function tomorrowStr() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function renderTodos() {
    const container = $("todoList");
    container.innerHTML = "";
    const today = todayStr();
    const tomorrow = tomorrowStr();
    const shown = todos.filter((t) =>
      todoFilter === "all" ? true : todoFilter === "done" ? t.done : !t.done);

    const remaining = todos.filter((t) => !t.done).length;
    $("todoCount").textContent = todos.length ? `${remaining} belum selesai dari ${todos.length}` : "";

    if (!shown.length) {
      const div = document.createElement("div");
      div.className = "empty";
      div.textContent = todos.length ? "Tidak ada tugas pada filter ini." : "Belum ada tugas. Tambahkan tugas pertama di atas.";
      container.appendChild(div);
      return;
    }

    // Kelompokkan per tanggal (data sudah urut naik dari Firestore)
    const groups = new Map();
    shown.forEach((t) => {
      const key = t.tanggal || "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    });

    groups.forEach((items, tanggal) => {
      // Yang belum selesai tampil lebih dulu di dalam satu tanggal
      items.sort((a, b) => Number(!!a.done) - Number(!!b.done));

      const group = document.createElement("section");
      group.className = "group";

      const head = document.createElement("h2");
      head.className = "group-head";
      const label = document.createElement("span");
      label.textContent = formatDate(tanggal);
      head.appendChild(label);

      const hasOpen = items.some((t) => !t.done);
      const tagText = tanggal === today ? "Hari ini"
        : tanggal === tomorrow ? "Besok"
        : tanggal && tanggal < today && hasOpen ? "Terlambat" : "";
      if (tagText) {
        const tag = document.createElement("span");
        tag.className = "tag " + (tagText === "Terlambat" ? "late" : tagText === "Hari ini" ? "today" : "");
        tag.textContent = tagText;
        head.appendChild(tag);
      }
      const count = document.createElement("span");
      count.className = "group-count";
      count.textContent = items.length + " tugas";
      head.appendChild(count);

      const ul = document.createElement("ul");
      ul.className = "list";
      items.forEach((t) => ul.appendChild(buildTodoItem(t, today)));

      group.append(head, ul);
      container.appendChild(group);
    });
  }

  function resetTodoForm(keepDate = false) {
    editingTodo = null;
    $("todoTitle").value = "";
    if (!keepDate) $("todoDate").value = todayStr();
    $("todoSave").textContent = "Tambah tugas";
    $("todoCancel").hidden = true;
  }
  function startEditTodo(t) {
    editingTodo = t.id;
    $("todoTitle").value = t.title;
    $("todoDate").value = t.tanggal || "";
    $("todoSave").textContent = "Simpan perubahan";
    $("todoCancel").hidden = false;
    $("todoTitle").focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveTodo() {
    const title = $("todoTitle").value.trim();
    const tanggal = $("todoDate").value;
    if (!title) { $("todoTitle").focus(); return showError("Tulis nama tugas terlebih dahulu."); }
    if (!tanggal) { $("todoDate").focus(); return showError("Pilih tanggal tugas."); }

    $("todoSave").disabled = true;
    await run(async () => {
      if (editingTodo) {
        await updateDoc(doc(db, "todos", editingTodo), { title, tanggal });
      } else {
        await addDoc(todosCol, { title, tanggal, done: false, createdAt: serverTimestamp() });
      }
      resetTodoForm(true); // tanggal yang dipilih tetap dipertahankan
    });
    $("todoSave").disabled = false;
  }
  $("todoSave").addEventListener("click", saveTodo);
  $("todoCancel").addEventListener("click", () => resetTodoForm());
  $("todoTitle").addEventListener("keydown", (e) => { if (e.key === "Enter") saveTodo(); });

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      todoFilter = chip.dataset.filter;
      document.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
      renderTodos();
    });
  });

  // ============================================================
  //  CATATAN
  // ============================================================
  let notes = [];
  let editingNote = null;

  function renderNotes() {
    const list = $("noteList");
    list.innerHTML = "";
    $("noteCount").textContent = notes.length ? `${notes.length} catatan` : "";

    if (!notes.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "Belum ada catatan. Tulis catatan pertama di atas.";
      list.appendChild(li);
      return;
    }

    notes.forEach((n) => {
      const li = document.createElement("li");
      li.className = "item note";

      const top = document.createElement("div");
      top.className = "top";
      const head = document.createElement("div");
      head.className = "body";
      const title = document.createElement("div");
      title.className = "title";
      title.textContent = n.title || "(Tanpa judul)";
      const date = document.createElement("div");
      date.className = "date";
      date.textContent = formatDate(n.tanggal);
      head.append(title, date);

      const actions = document.createElement("div");
      actions.className = "item-actions";
      const edit = document.createElement("button");
      edit.className = "btn-text"; edit.textContent = "Ubah";
      edit.addEventListener("click", () => startEditNote(n));
      const del = document.createElement("button");
      del.className = "btn-text danger"; del.textContent = "Hapus";
      del.addEventListener("click", () => {
        if (confirm("Hapus catatan ini?")) run(() => deleteDoc(doc(db, "notes", n.id)));
      });
      actions.append(edit, del);
      top.append(head, actions);

      const content = document.createElement("div");
      content.className = "content";
      content.textContent = n.content || "";

      li.append(top, content);
      list.appendChild(li);
    });
  }

  function resetNoteForm(keepDate = false) {
    editingNote = null;
    $("noteTitle").value = "";
    $("noteContent").value = "";
    if (!keepDate) $("noteDate").value = todayStr();
    $("noteSave").textContent = "Simpan catatan";
    $("noteCancel").hidden = true;
  }
  function startEditNote(n) {
    editingNote = n.id;
    $("noteTitle").value = n.title || "";
    $("noteContent").value = n.content || "";
    $("noteDate").value = n.tanggal || todayStr();
    $("noteSave").textContent = "Simpan perubahan";
    $("noteCancel").hidden = false;
    $("noteTitle").focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveNote() {
    const title = $("noteTitle").value.trim();
    const content = $("noteContent").value.trim();
    const tanggal = $("noteDate").value;
    if (!title && !content) { $("noteTitle").focus(); return showError("Isi judul atau isi catatan terlebih dahulu."); }
    if (!tanggal) { $("noteDate").focus(); return showError("Pilih tanggal catatan."); }

    $("noteSave").disabled = true;
    await run(async () => {
      if (editingNote) {
        await updateDoc(doc(db, "notes", editingNote), { title, content, tanggal });
      } else {
        await addDoc(notesCol, { title, content, tanggal, createdAt: serverTimestamp() });
      }
      resetNoteForm(true); // tanggal yang dipilih tetap dipertahankan
    });
    $("noteSave").disabled = false;
  }
  $("noteSave").addEventListener("click", saveNote);
  $("noteCancel").addEventListener("click", () => resetNoteForm());
}
