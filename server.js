const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

const app = express();
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;
const dir = path.join(__dirname, "data");
const file = path.join(dir, "db.json");

fs.mkdirSync(dir, { recursive: true });

const blank = () => ({
  users: [],
  questions: [],
  exams: [],
  attempts: []
});

let db;

try {
  db = { ...blank(), ...JSON.parse(fs.readFileSync(file, "utf8")) };
} catch {
  db = blank();
}

const save = () => {
  const temp = file + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(db, null, 2));
  fs.renameSync(temp, file);
};

const id = p =>
  p + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const me = r => db.users.find(u => u.id === r.session.uid);

const safe = u => ({
  id: u.id,
  username: u.username,
  role: u.role,
  className: u.className || "",
  approved: u.approved !== false,
  canManageQuestions: !!u.canManageQuestions
});

const auth = (r, s, n) =>
  me(r) ? n() : s.status(401).json({ error: "Sign in required." });

const admin = (r, s, n) =>
  auth(r, s, () =>
    me(r).role === "admin"
      ? n()
      : s.status(403).json({ error: "Admin only." })
  );

const staff = (r, s, n) =>
  auth(r, s, () =>
    ["admin", "teacher"].includes(me(r).role) &&
    me(r).approved !== false
      ? n()
      : s.status(403).json({ error: "Approved staff only." })
  );

const qperm = (r, s, n) =>
  staff(r, s, () =>
    me(r).role === "admin" || me(r).canManageQuestions
      ? n()
      : s.status(403).json({
          error: "Admin has not granted question permission."
        })
  );

app.use(express.json({ limit: "8mb" }));

app.use(session({
  name: "cbthub.sid",
  secret: process.env.SESSION_SECRET || "change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 43200000
  }
}));

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/status", (r, s) => {
  s.json({
    setup: !db.users.some(u => u.role === "admin"),
    user: me(r) ? safe(me(r)) : null
  });
});

app.post("/api/setup", async (r, s) => {
  if (db.users.some(u => u.role === "admin")) {
    return s.status(409).json({ error: "Admin already exists" });
  }

  const username = String(r.body.username || "").trim();
  const password = String(r.body.password || "");

  if (username.length < 3 || password.length < 10) {
    return s.status(400).json({
      error: "Username 3+ and password 10+ required"
    });
  }

  const u = {
    id: id("u"),
    username,
    passwordHash: await bcrypt.hash(password, 12),
    role: "admin",
    approved: true
  };

  db.users.push(u);
  save();

  r.session.uid = u.id;

  r.session.save(err => {
    if (err) {
      return s.status(500).json({ error: "Could not save login session." });
    }
    s.json({ user: safe(u) });
  });
});

app.post("/api/login", async (r, s) => {
  const u = db.users.find(
    x => x.username.toLowerCase() ===
      String(r.body.username || "").trim().toLowerCase()
  );

  if (!u || !await bcrypt.compare(
    String(r.body.password || ""),
    u.passwordHash
  )) {
    return s.status(401).json({ error: "Wrong login details" });
  }

  if (u.approved === false) {
    return s.status(403).json({
      error: "Account awaits admin approval"
    });
  }

  r.session.uid = u.id;

  r.session.save(err => {
    if (err) {
      return s.status(500).json({ error: "Could not save login session." });
    }
    s.json({ user: safe(u) });
  });
});

app.post("/api/logout", (r, s) => {
  r.session.destroy(() => s.json({ ok: true }));
});

app.get("/api/users", admin, (r, s) => {
  s.json(db.users.map(safe));
});

app.post("/api/users", admin, async (r, s) => {
  const username = String(r.body.username || "").trim();
  const password = String(r.body.password || "");
  const role = r.body.role;

  if (
    username.length < 3 ||
    password.length < 8 ||
    !["teacher", "student"].includes(role)
  ) {
    return s.status(400).json({
      error: "Username 3+, password 8+, role teacher/student required"
    });
  }

  if (db.users.some(
    u => u.username.toLowerCase() === username.toLowerCase()
  )) {
    return s.status(409).json({ error: "Username already exists" });
  }

  const u = {
    id: id("u"),
    username,
    passwordHash: await bcrypt.hash(password, 12),
    role,
    approved: role === "student" || r.body.approved === true,
    canManageQuestions: false,
    className: String(r.body.className || "").trim()
  };

  db.users.push(u);
  save();

  s.json({ user: safe(u) });
});

app.patch("/api/users/:id", admin, (r, s) => {
  const u = db.users.find(x => x.id === r.params.id);

  if (!u || u.role === "admin") {
    return s.status(404).json({ error: "Account not found" });
  }

  if (typeof r.body.approved === "boolean") {
    u.approved = r.body.approved;
  }

  if (
    typeof r.body.canManageQuestions === "boolean" &&
    u.role === "teacher"
  ) {
    u.canManageQuestions = r.body.canManageQuestions;
  }

  save();
  s.json({ user: safe(u) });
});

app.get("/api/questions", staff, (r, s) => {
  const u = me(r);

  s.json(
    db.questions
      .filter(q =>
        u.role === "admin" ||
        q.owner === u.id ||
        u.canManageQuestions
      )
      .map(q => ({
        ...q,
        answer:
          u.role === "admin" || u.canManageQuestions
            ? q.answer
            : undefined
      }))
  );
});

app.post("/api/questions", qperm, (r, s) => {
  const { text, options, answer } = r.body;

  if (
    !String(text || "").trim() ||
    !Array.isArray(options) ||
    options.length !== 4 ||
    options.some(x => !String(x).trim()) ||
    ![0, 1, 2, 3].includes(+answer)
  ) {
    return s.status(400).json({
      error: "Question needs text, four options and correct answer"
    });
  }

  const q = {
    id: id("q"),
    text: String(text).trim(),
    options: options.map(String),
    answer: +answer,
    subject: String(r.body.subject || "General"),
    className: String(r.body.className || ""),
    topic: String(r.body.topic || ""),
    owner: me(r).id
  };

  db.questions.push(q);
  save();

  s.json({ question: { ...q, answer: undefined } });
});

app.delete("/api/questions/:id", qperm, (r, s) => {
  const q = db.questions.find(x => x.id === r.params.id);

  if (!q) {
    return s.status(404).json({ error: "Question not found" });
  }

  if (me(r).role !== "admin" && q.owner !== me(r).id) {
    return s.status(403).json({ error: "Own questions only" });
  }

  db.questions = db.questions.filter(x => x.id !== q.id);
  save();

  s.json({ ok: true });
});

app.get("/api/exams", staff, (r, s) => {
  const u = me(r);

  s.json(
    db.exams
      .filter(e => u.role === "admin" || e.creator === u.id)
      .map(e => ({
        id: e.id,
        title: e.title,
        code: e.code,
        className: e.className,
        expiresAt: e.expiresAt,
        duration: e.duration,
        status: e.status
      }))
  );
});

app.post("/api/exams", qperm, (r, s) => {
  const ids = Array.isArray(r.body.questionIds)
    ? r.body.questionIds
    : [];

  const qs = ids
    .map(x => db.questions.find(q => q.id === x))
    .filter(Boolean);

  if (!String(r.body.title || "").trim() || !qs.length) {
    return s.status(400).json({
      error: "Title and saved questions required"
    });
  }

  let code;

  do {
    code = Math.random().toString(36).slice(2, 8).toUpperCase();
  } while (db.exams.some(e => e.code === code));

  const duration = Math.max(
    1,
    Math.min(480, +r.body.duration || 60)
  );

  const hours = Math.max(
    1,
    Math.min(720, +r.body.expiryHours || 24)
  );

  const e = {
    id: id("e"),
    title: String(r.body.title).trim(),
    code,
    className: String(r.body.className || ""),
    duration,
    questionIds: qs.map(q => q.id),
    creator: me(r).id,
    expiresAt: new Date(Date.now() + hours * 3600000).toISOString(),
    status: "scheduled",
    running: false,
    paused: false,
    remaining: duration * 60,
    startedAt: null,
    active: []
  };

  db.exams.push(e);
  save();

  s.json({
    exam: {
      id: e.id,
      code: e.code,
      expiresAt: e.expiresAt
    }
  });
});

app.post("/api/exams/:id/control", admin, (r, s) => {
  const e = db.exams.find(x => x.id === r.params.id);

  if (!e) {
    return s.status(404).json({ error: "Exam not found" });
  }

  const a = r.body.action;

  if (a === "start") {
    e.running = true;
    e.paused = false;
    e.status = "running";
    e.startedAt = Date.now();
    e.remaining = e.duration * 60;
  } else if (a === "pause" && e.running && !e.paused) {
    e.remaining = Math.max(
      0,
      e.remaining - Math.floor((Date.now() - e.startedAt) / 1000)
    );
    e.paused = true;
  } else if (a === "resume" && e.running && e.paused) {
    e.startedAt = Date.now();
    e.paused = false;
  } else if (a === "end") {
    e.running = false;
    e.paused = true;
    e.status = "ended";
    e.remaining = 0;
  } else {
    return s.status(400).json({ error: "Invalid action" });
  }

  save();
  s.json({ ok: true });
});

const remaining = e =>
  e.running && !e.paused
    ? Math.max(
        0,
        e.remaining - Math.floor((Date.now() - e.startedAt) / 1000)
      )
    : e.remaining;

app.get("/api/exams/:id/monitor", admin, (r, s) => {
  const e = db.exams.find(x => x.id === r.params.id);

  if (!e) {
    return s.status(404).json({ error: "Exam not found" });
  }

  s.json({
    title: e.title,
    status: e.status,
    remaining: remaining(e),
    students: e.active
  });
});

app.post("/api/student/start", auth, (r, s) => {
  const u = me(r);

  if (u.role !== "student") {
    return s.status(403).json({ error: "Student account required" });
  }

  const e = db.exams.find(
    x => x.code === String(r.body.code || "").trim().toUpperCase()
  );

  if (!e) {
    return s.status(404).json({ error: "Invalid exam code" });
  }

  if (Date.now() > Date.parse(e.expiresAt)) {
    return s.status(410).json({ error: "Exam code expired" });
  }

  if (
    e.className &&
    e.className.toLowerCase() !== String(u.className || "").toLowerCase()
  ) {
    return s.status(403).json({
      error: "Exam not assigned to your class"
    });
  }

  if (!e.running) {
    return s.status(403).json({ error: "Exam has not started" });
  }

  let a = db.attempts.find(
    x => x.examId === e.id && x.studentId === u.id
  );

  if (a?.submitted && !a.retakeApproved) {
    return s.status(403).json({
      error: "Already submitted. Ask admin for a retake"
    });
  }

  if (a?.retakeApproved) {
    a.submitted = false;
    a.retakeApproved = false;
    a.answers = {};
  }

  if (!a) {
    a = {
      id: id("a"),
      examId: e.id,
      studentId: u.id,
      student: u.username,
      answers: {},
      submitted: false
    };

    db.attempts.push(a);
  }

  a.status = "writing";
  a.lastSeen = new Date().toISOString();

  let st = e.active.find(x => x.studentId === u.id);

  if (!st) {
    st = { studentId: u.id, student: u.username };
    e.active.push(st);
  }

  Object.assign(st, {
    status: "writing",
    lastSeen: a.lastSeen
  });

  const qs = e.questionIds
    .map(x => db.questions.find(q => q.id === x))
    .filter(Boolean);

  save();

  s.json({
    examId: e.id,
    title: e.title,
    duration: e.duration,
    questions: qs.map(({ id, text, options }) => ({
      id,
      text,
      options
    })),
    answers: a.answers
  });
});

app.post("/api/student/save", auth, (r, s) => {
  const u = me(r);

  const a = db.attempts.find(
    x => x.examId === r.body.examId && x.studentId === u.id
  );

  if (u.role !== "student" || !a || a.submitted) {
    return s.status(403).json({ error: "No active attempt" });
  }

  a.answers = {
    ...a.answers,
    ...(r.body.answers || {})
  };

  a.lastSeen = new Date().toISOString();

  save();
  s.json({ ok: true });
});

app.post("/api/student/submit", auth, (r, s) => {
  const u = me(r);

  const e = db.exams.find(x => x.id === r.body.examId);

  const a = db.attempts.find(
    x => x.examId === r.body.examId && x.studentId === u.id
  );

  if (u.role !== "student" || !e || !a || a.submitted) {
    return s.status(409).json({
      error: "Attempt unavailable or submitted"
    });
  }

  a.answers = {
    ...a.answers,
    ...(r.body.answers || {})
  };

  const qs = e.questionIds
    .map(x => db.questions.find(q => q.id === x))
    .filter(Boolean);

  const score = qs.filter(
    q => +a.answers[q.id] === q.answer
  ).length;

  a.submitted = true;
  a.status = "submitted";

  a.result = {
    student: u.username,
    exam: e.title,
    examId: e.id,
    score,
    total: qs.length,
    percentage: Math.round(score / Math.max(1, qs.length) * 100),
    submittedAt: new Date().toISOString()
  };

  const st = e.active.find(x => x.studentId === u.id);

  if (st) {
    st.status = "submitted";
  }

  save();
  s.json(a.result);
});

app.get("/api/results", staff, (r, s) => {
  const u = me(r);

  s.json(
    db.attempts
      .filter(a =>
        a.result &&
        (
          u.role === "admin" ||
          db.exams.find(e => e.id === a.examId)?.creator === u.id
        )
      )
      .map(a => a.result)
  );
});

app.post("/api/retakes/:id/approve", admin, (r, s) => {
  const a = db.attempts.find(
    x => x.id === r.params.id && x.submitted
  );

  if (!a) {
    return s.status(404).json({ error: "Attempt not found" });
  }

  a.retakeApproved = true;
  save();

  s.json({ ok: true });
});

app.get("*", (r, s) => {
  s.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("CBT HUB running on port " + PORT);
});
