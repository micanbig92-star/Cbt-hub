const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const os = require("os");
const app = express();
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

const blankDB = () => ({
  users: [],
  questions: [],
  exams: [],
  attempts: []
});

let db;

try {
  db = { ...blankDB(), ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) };
} catch {
  db = blankDB();
}

function save() {
  const temp = DB_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(db, null, 2));
  fs.renameSync(temp, DB_FILE);
}

function makeId(prefix) {
  return prefix + "_" + Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8);
}
// Shuffle questions randomly using Fisher-Yates.
function shuffleArray(items) {
  const shuffled = [...items];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}
function currentUser(req) {
  return db.users.find(user => user.id === req.session.uid);
}

function safeUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    className: user.className || "",
    approved: user.approved !== false,
    canManageQuestions: !!user.canManageQuestions
  };
}

function requireLogin(req, res, next) {
  if (!currentUser(req)) {
    return res.status(401).json({ error: "Please sign in." });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!currentUser(req)) {
    return res.status(401).json({ error: "Please sign in." });
  }
  if (currentUser(req).role !== "admin") {
    return res.status(403).json({ error: "Administrator access only." });
  }
  next();
}

function requireStaff(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "Please sign in." });

  if (!["admin", "teacher"].includes(user.role) || user.approved === false) {
    return res.status(403).json({ error: "Approved staff access required." });
  }
  next();
}

function requireQuestionPermission(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "Please sign in." });

  if (
    user.role === "admin" ||
    (user.role === "teacher" &&
      user.approved !== false &&
      user.canManageQuestions === true)
  ) {
    return next();
  }

  return res.status(403).json({
    error: "You do not have permission to manage questions."
  });
}

app.use(express.json({ limit: "8mb" }));

app.use(session({
  name: "cbthub.sid",
  secret: process.env.SESSION_SECRET || "replace-this-with-a-long-random-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 12 * 60 * 60 * 1000
  }
}));

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/status", (req, res) => {
  const user = currentUser(req);
  res.json({
    setup: !db.users.some(u => u.role === "admin"),
    user: user ? safeUser(user) : null
  });
});

// First administrator setup. Only works while no administrator exists.
app.post("/api/setup", async (req, res) => {
  if (db.users.some(u => u.role === "admin")) {
    return res.status(409).json({ error: "Administrator already exists." });
  }

  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (username.length < 3 || password.length < 10) {
    return res.status(400).json({
      error: "Username must be at least 3 characters and password at least 10."
    });
  }

  if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: "Username already exists." });
  }

  const user = {
    id: makeId("u"),
    username,
    passwordHash: await bcrypt.hash(password, 12),
    role: "admin",
    approved: true,
    canManageQuestions: true,
    className: ""
  };

  db.users.push(user);
  save();

  req.session.uid = user.id;
  req.session.save(err => {
    if (err) return res.status(500).json({ error: "Could not create session." });
    res.json({ user: safeUser(user) });
  });
});

// Public student registration. The role is assigned by the server,
// never accepted from the browser.
app.post("/api/student/register", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const className = String(req.body.className || "").trim();

  if (username.length < 3 || password.length < 8) {
    return res.status(400).json({
      error: "Username must be at least 3 characters and password at least 8."
    });
  }

  if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: "That username is already taken." });
  }

  const user = {
    id: makeId("u"),
    username,
    passwordHash: await bcrypt.hash(password, 12),
    role: "student",
    approved: true,
    canManageQuestions: false,
    className
  };

  db.users.push(user);
  save();

  req.session.uid = user.id;
  req.session.save(err => {
    if (err) return res.status(500).json({ error: "Could not create session." });
    res.status(201).json({ user: safeUser(user) });
  });
});

app.post("/api/login", async (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  const user = db.users.find(u => u.username.toLowerCase() === username);

  if (!user || !await bcrypt.compare(password, user.passwordHash)) {
    return res.status(401).json({ error: "Incorrect username or password." });
  }

  if (user.approved === false) {
    return res.status(403).json({ error: "Your account is awaiting approval." });
  }

  req.session.uid = user.id;
  req.session.save(err => {
    if (err) return res.status(500).json({ error: "Could not create session." });
    res.json({ user: safeUser(user) });
  });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: "Could not sign out." });
    res.clearCookie("cbthub.sid");
    res.json({ ok: true });
  });
});

// Admin account management
app.get("/api/users", requireAdmin, (req, res) => {
  res.json(db.users.map(safeUser));
});

app.post("/api/users", requireAdmin, async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const role = req.body.role;

  if (
    username.length < 3 ||
    password.length < 8 ||
    !["student", "teacher"].includes(role)
  ) {
    return res.status(400).json({ error: "Check the username, password and role." });
  }

  if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: "Username already exists." });
  }

  const user = {
    id: makeId("u"),
    username,
    passwordHash: await bcrypt.hash(password, 12),
    role,
    approved: role === "student" || req.body.approved === true,
    canManageQuestions: false,
    className: String(req.body.className || "").trim()
  };

  db.users.push(user);
  save();
  res.status(201).json({ user: safeUser(user) });
});

app.patch("/api/users/:id", requireAdmin, (req, res) => {
  const user = db.users.find(u => u.id === req.params.id);
  if (!user || user.role === "admin") {
    return res.status(404).json({ error: "Account not found." });
  }

  if (typeof req.body.approved === "boolean") {
    user.approved = req.body.approved;
  }

  if (user.role === "teacher" &&
      typeof req.body.canManageQuestions === "boolean") {
    user.canManageQuestions = req.body.canManageQuestions;
  }

  save();
  res.json({ user: safeUser(user) });
});
// Delete a non-administrator account while keeping exam results.
app.delete("/api/users/:id", requireAdmin, (req, res) => {
  const user = db.users.find(u => u.id === req.params.id);

  if (!user || user.role === "admin") {
    return res.status(404).json({ error: "Account not found." });
  }

  db.users = db.users.filter(u => u.id !== user.id);
  save();
  res.json({ ok: true });
});
// Questions
app.get("/api/questions", requireStaff, (req, res) => {
  const user = currentUser(req);
  const questions = db.questions.filter(q =>
    user.role === "admin" ||
    user.canManageQuestions ||
    q.owner === user.id
  );

  res.json(questions.map(q => ({
    ...q,
    answer: user.role === "admin" || user.canManageQuestions
      ? q.answer
      : undefined
  })));
});

app.post("/api/questions", requireQuestionPermission, (req, res) => {
  const text = String(req.body.text || "").trim();
  const options = req.body.options;
  const answer = Number(req.body.answer);
  const image = String(req.body.image || "");

  if (!text || !Array.isArray(options) || options.length !== 4 ||
      options.some(option => !String(option).trim()) ||
      ![0, 1, 2, 3].includes(answer)) {
    return res.status(400).json({
      error: "A question, four options and a correct answer are required."
    });
  }

  if (image && (
    !image.startsWith("data:image/png;base64,") ||
    image.length > 1800000
  )) {
    return res.status(400).json({
      error: "The drawing must be a PNG image smaller than the allowed limit."
    });
  }

  const question = {
    id: makeId("q"),
    text,
    options: options.map(x => String(x).trim()),
    answer,
    subject: String(req.body.subject || "General").trim(),
    className: String(req.body.className || "").trim(),
    topic: String(req.body.topic || "").trim(),
    image,
    owner: currentUser(req).id
  };

  db.questions.push(question);
  save();

  res.status(201).json({
    question: { ...question, answer: undefined }
  });
});
// Edit an existing question
app.patch("/api/questions/:id", requireQuestionPermission, (req, res) => {
  const question = db.questions.find(q => q.id === req.params.id);

  if (!question) {
    return res.status(404).json({ error: "Question not found." });
  }

  const user = currentUser(req);

  if (user.role !== "admin" && question.owner !== user.id) {
    return res.status(403).json({
      error: "You can only edit your own questions."
    });
  }

  const text = String(req.body.text || "").trim();
  const options = req.body.options;
  const answer = Number(req.body.answer);
  const image = String(req.body.image || "");

  if (
    !text ||
    !Array.isArray(options) ||
    options.length !== 4 ||
    options.some(option => !String(option).trim()) ||
    ![0, 1, 2, 3].includes(answer)
  ) {
    return res.status(400).json({
      error: "Enter a question, four options and a correct answer."
    });
  }

  if (
    image &&
    (!image.startsWith("data:image/png;base64,") || image.length > 1800000)
  ) {
    return res.status(400).json({
      error: "The drawing must be a PNG image within the allowed limit."
    });
  }

  question.text = text;
  question.options = options.map(option => String(option).trim());
  question.answer = answer;
  question.image = image;
  question.subject = String(req.body.subject || "General").trim();
  question.className = String(req.body.className || "").trim();
  question.topic = String(req.body.topic || "").trim();

  save();

  res.json({ ok: true, question });
});
app.delete("/api/questions/:id", requireQuestionPermission, (req, res) => {
  const question = db.questions.find(q => q.id === req.params.id);
  if (!question) return res.status(404).json({ error: "Question not found." });

  const user = currentUser(req);
  if (user.role !== "admin" && question.owner !== user.id) {
    return res.status(403).json({ error: "You can only delete your own questions." });
  }

  db.questions = db.questions.filter(q => q.id !== question.id);
  save();
  res.json({ ok: true });
});

// Exams
app.get("/api/exams", requireStaff, (req, res) => {
  const user = currentUser(req);

  res.json(db.exams
    .filter(e => user.role === "admin" || e.creator === user.id)
    .map(e => ({
      id: e.id,
      title: e.title,
      code: e.code,
      className: e.className,
      expiresAt: e.expiresAt,
      duration: e.duration,
      status: e.status
    })));
});

app.post("/api/exams", requireQuestionPermission, (req, res) => {
  const questionIds = Array.isArray(req.body.questionIds)
    ? req.body.questionIds
    : [];

  const questions = questionIds
    .map(id => db.questions.find(q => q.id === id))
    .filter(Boolean);

  const title = String(req.body.title || "").trim();

  if (!title || !questions.length) {
    return res.status(400).json({ error: "Exam title and questions are required." });
  }

  let code;
  do {
    code = Math.random().toString(36).slice(2, 8).toUpperCase();
  } while (db.exams.some(e => e.code === code));

  const duration = Math.max(1, Math.min(480, Number(req.body.duration) || 60));
  const expiryHours = Math.max(1, Math.min(720, Number(req.body.expiryHours) || 24));

  const exam = {
    id: makeId("e"),
    title,
    code,
    className: String(req.body.className || "").trim(),
    duration,
    questionIds: questions.map(q => q.id),
    creator: currentUser(req).id,
    expiresAt: new Date(Date.now() + expiryHours * 3600000).toISOString(),
    status: "scheduled",
    running: false,
    paused: false,
    remaining: duration * 60,
    startedAt: null,
    active: []
  };

  db.exams.push(exam);
  save();

  res.status(201).json({
    exam: {
      id: exam.id,
      code: exam.code,
      expiresAt: exam.expiresAt
    }
  });
});

app.post("/api/exams/:id/control", requireAdmin, (req, res) => {
  const exam = db.exams.find(e => e.id === req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found." });

  const action = req.body.action;

  if (action === "start") {
    exam.running = true;
    exam.paused = false;
    exam.status = "running";
    exam.startedAt = Date.now();
    exam.remaining = exam.duration * 60;
  } else if (action === "pause" && exam.running && !exam.paused) {
    exam.remaining = Math.max(
      0,
      exam.remaining - Math.floor((Date.now() - exam.startedAt) / 1000)
    );
    exam.paused = true;
  } else if (action === "resume" && exam.running && exam.paused) {
    exam.startedAt = Date.now();
    exam.paused = false;
  } else if (action === "end") {
    exam.running = false;
    exam.paused = true;
    exam.status = "ended";
    exam.remaining = 0;
  } else {
    return res.status(400).json({ error: "Invalid exam action." });
  }

  save();
  res.json({ ok: true });
});
// Admin: delete an ended exam without deleting its saved results.
app.delete("/api/exams/:id", requireAdmin, (req, res) => {
  const exam = db.exams.find(e => e.id === req.params.id);

  if (!exam) {
    return res.status(404).json({ error: "Exam not found." });
  }

  if (exam.status !== "ended") {
    return res.status(400).json({
      error: "Only ended exams can be deleted."
    });
  }

  db.exams = db.exams.filter(e => e.id !== exam.id);
  save();
  res.json({ ok: true, resultsPreserved: true });
});

// Admin: delete one student's saved result.
app.delete("/api/results/:attemptId", requireAdmin, (req, res) => {
  const attempt = db.attempts.find(a => a.id === req.params.attemptId);

  if (!attempt || !attempt.result) {
    return res.status(404).json({ error: "Result not found." });
  }

  attempt.result = null;
  save();
  res.json({ ok: true });
});

// Admin: delete all saved results for one exam.
app.delete("/api/results/exam/:examId", requireAdmin, (req, res) => {
  const matching = db.attempts.filter(
    a => a.examId === req.params.examId && a.result
  );

  if (!matching.length) {
    return res.status(404).json({ error: "No results found for this exam." });
  }

  matching.forEach(a => {
    a.result = null;
  });

  save();
  res.json({ ok: true, deleted: matching.length });
});
function examRemaining(exam) {
  if (exam.running && !exam.paused) {
    return Math.max(
      0,
      exam.remaining - Math.floor((Date.now() - exam.startedAt) / 1000)
    );
  }
  return exam.remaining;
}

app.get("/api/exams/:id/monitor", requireAdmin, (req, res) => {
  const exam = db.exams.find(e => e.id === req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found." });

  res.json({
    title: exam.title,
    status: exam.status,
    remaining: examRemaining(exam),
    students: exam.active
  });
});
// Show the subjects available in an exam before the student starts.
app.post("/api/student/subjects", requireLogin, (req, res) => {
  const user = currentUser(req);

  if (user.role !== "student") {
    return res.status(403).json({ error: "A student account is required." });
  }

  const code = String(req.body.code || "").trim().toUpperCase();
  const exam = db.exams.find(e => e.code === code);

  if (!exam) return res.status(404).json({ error: "Invalid exam code." });

  if (Date.now() > Date.parse(exam.expiresAt)) {
    return res.status(410).json({ error: "This exam code has expired." });
  }

  if (exam.className &&
      exam.className.toLowerCase() !== String(user.className || "").toLowerCase()) {
    return res.status(403).json({ error: "This exam is not assigned to your class." });
  }

  if (!exam.running || exam.status !== "running") {
    return res.status(403).json({ error: "The exam has not started." });
  }

  const subjects = [...new Set(
    exam.questionIds
      .map(id => db.questions.find(q => q.id === id))
      .filter(Boolean)
      .map(q => String(q.subject || "General").trim() || "General")
  )].sort();

  res.json({
    title: exam.title,
    duration: exam.duration,
    subjects
  });
});
// Student exam routes

app.post("/api/student/start", requireLogin, (req, res) => {
  const user = currentUser(req);

  if (user.role !== "student") {
    return res.status(403).json({ error: "A student account is required." });
  }

  const code = String(req.body.code || "").trim().toUpperCase();
  const exam = db.exams.find(e => e.code === code);

  if (!exam) return res.status(404).json({ error: "Invalid exam code." });

  if (Date.now() > Date.parse(exam.expiresAt)) {
    return res.status(410).json({ error: "This exam code has expired." });
  }

  if (exam.className &&
      exam.className.toLowerCase() !== String(user.className || "").toLowerCase()) {
    return res.status(403).json({ error: "This exam is not assigned to your class." });
  }

  if (!exam.running || exam.status !== "running") {
    return res.status(403).json({ error: "The exam has not started." });
  }

  const availableSubjects = [...new Set(
    exam.questionIds
      .map(id => db.questions.find(q => q.id === id))
      .filter(Boolean)
      .map(q => String(q.subject || "General").trim() || "General")
  )];

  const requestedSubjects = Array.isArray(req.body.subjects)
    ? [...new Set(req.body.subjects.map(s => String(s).trim()).filter(Boolean))]
    : [];

  let selectedSubjects;

  if (availableSubjects.length < 4) {
    return res.status(400).json({
      error: "This exam must have at least four available subjects."
    });
  }

  if (
    requestedSubjects.length < 4 ||
    requestedSubjects.some(subject =>
      !availableSubjects.some(
        available => available.toLowerCase() === subject.toLowerCase()
      )
    )
  ) {
    return res.status(400).json({
      error: "Choose at least four available subjects."
    });
  }

  selectedSubjects = availableSubjects.filter(subject =>
    requestedSubjects.some(
      chosen => chosen.toLowerCase() === subject.toLowerCase()
    )
  );

  let attempt = db.attempts.find(
    a => a.examId === exam.id && a.studentId === user.id
  );

  if (attempt?.submitted && !attempt.retakeApproved) {
    return res.status(403).json({
      error: "You have already submitted this exam. Ask the administrator about a retake."
    });
  }

  if (attempt?.retakeApproved) {
    attempt.submitted = false;
    attempt.retakeApproved = false;
    attempt.answers = {};
    attempt.questionOrder = null;
    attempt.selectedSubjects = null;
  }

  if (!attempt) {
    attempt = {
      id: makeId("a"),
      examId: exam.id,
      studentId: user.id,
      student: user.username,
      answers: {},
      submitted: false
    };

    db.attempts.push(attempt);
  }

  const selectedIds = exam.questionIds.filter(id => {
    const question = db.questions.find(q => q.id === id);
    const subject = String(question?.subject || "General").trim() || "General";

    return selectedSubjects.some(
      chosen => chosen.toLowerCase() === subject.toLowerCase()
    );
  });

  // A student cannot change subjects after beginning the exam.
  if (
    Array.isArray(attempt.questionOrder) &&
    Array.isArray(attempt.selectedSubjects) &&
    JSON.stringify([...attempt.selectedSubjects].sort()) !==
    JSON.stringify([...selectedSubjects].sort())
  ) {
    return res.status(409).json({
      error: "You already started this exam with a different subject selection."
    });
  }

  // Save the student's randomized question order.
  if (
    !Array.isArray(attempt.questionOrder) ||
    attempt.questionOrder.length !== selectedIds.length
  ) {
    attempt.questionOrder = shuffleArray(selectedIds);
    attempt.selectedSubjects = selectedSubjects;
    attempt.answers = {};
  }

  attempt.status = "writing";
  attempt.lastSeen = new Date().toISOString();

  let activeStudent = exam.active.find(s => s.studentId === user.id);

  if (!activeStudent) {
    activeStudent = {
      studentId: user.id,
      student: user.username
    };

    exam.active.push(activeStudent);
  }

  activeStudent.status = "writing";
  activeStudent.lastSeen = attempt.lastSeen;

  const questions = attempt.questionOrder
    .map(id => db.questions.find(q => q.id === id))
    .filter(Boolean);

  save();

  res.json({
    examId: exam.id,
    title: exam.title,
    duration: exam.duration,
    remainingSeconds: examRemaining(exam),
    selectedSubjects: attempt.selectedSubjects || selectedSubjects,

    questions: questions.map(q => ({
      id: q.id,
      text: q.text,
      options: q.options,
      image: q.image || "",
      subject: String(q.subject || "General").trim() || "General"
    })),

    answers: attempt.answers
  });
});

app.post("/api/student/save", requireLogin, (req, res) => {
  const user = currentUser(req);
  if (user.role !== "student") {
    return res.status(403).json({ error: "Student account required." });
  }

  const attempt = db.attempts.find(
    a => a.examId === req.body.examId && a.studentId === user.id
  );

  if (!attempt || attempt.submitted) {
    return res.status(403).json({ error: "No active attempt." });
  }

  const incoming = req.body.answers && typeof req.body.answers === "object"
    ? req.body.answers
    : {};

  attempt.answers = { ...attempt.answers, ...incoming };
  attempt.lastSeen = new Date().toISOString();

  save();
  res.json({ ok: true });
});

app.post("/api/student/submit", requireLogin, (req, res) => {
  const user = currentUser(req);

  if (user.role !== "student") {
    return res.status(403).json({ error: "Student account required." });
  }

  const exam = db.exams.find(e => e.id === req.body.examId);

  const attempt = db.attempts.find(
    a => a.examId === req.body.examId && a.studentId === user.id
  );

  if (!exam || !attempt || attempt.submitted) {
    return res.status(409).json({
      error: "Attempt unavailable or already submitted."
    });
  }

  const incoming = req.body.answers && typeof req.body.answers === "object"
    ? req.body.answers
    : {};

  attempt.answers = { ...attempt.answers, ...incoming };

  const questionIds = Array.isArray(attempt.questionOrder)
    ? attempt.questionOrder
    : exam.questionIds;

  const questions = questionIds
    .map(id => db.questions.find(q => q.id === id))
    .filter(Boolean);

  const score = questions.filter(
    q => Number(attempt.answers[q.id]) === q.answer
  ).length;

  // Calculate each subject separately.
  const subjectScores = {};

  questions.forEach(q => {
    const subject = String(q.subject || "General").trim() || "General";

    if (!subjectScores[subject]) {
      subjectScores[subject] = {
        score: 0,
        total: 0
      };
    }

    subjectScores[subject].total++;

    if (Number(attempt.answers[q.id]) === q.answer) {
      subjectScores[subject].score++;
    }
  });

  attempt.syncStatus = "pending";
  attempt.syncedAt = null;
  attempt.submitted = true;
  attempt.status = "submitted";

  attempt.result = {
    student: user.username,
    className: user.className || "",
    exam: exam.title,
    examId: exam.id,
    score,
    total: questions.length,
    percentage: Math.round(
      score / Math.max(1, questions.length) * 100
    ),
    subjectScores,
    submittedAt: new Date().toISOString()
  };

  const activeStudent = exam.active.find(
    s => s.studentId === user.id
  );

  if (activeStudent) {
    activeStudent.status = "submitted";
  }

  save();

  res.json(attempt.result);
});
// Student result history
app.get("/api/student/results", requireLogin, (req, res) => {
  const user = currentUser(req);

  if (user.role !== "student") {
    return res.status(403).json({ error: "Student account required." });
  }

  const results = db.attempts
    .filter(a => a.studentId === user.id && a.result)
    .map(a => ({ ...a.result, attemptId: a.id }));

  results.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  res.json(results);
});
// Results
app.get("/api/results", requireStaff, (req, res) => {
  const user = currentUser(req);

  const results = db.attempts
    .filter(a => a.result && (
      user.role === "admin" ||
      db.exams.find(e => e.id === a.examId)?.creator === user.id
    ))
    .map(a => ({
      ...a.result,
      attemptId: a.id,
      examId: a.examId
    }));

  res.json(results);
});
// Download exam results as CSV
app.get("/api/results/export.csv", requireStaff, (req, res) => {
  const user = currentUser(req);

  const results = db.attempts
    .filter(a => a.result && (
      user.role === "admin" ||
      db.exams.find(e => e.id === a.examId)?.creator === user.id
    ))
    .map(a => a.result);

  const columns = [
    "Student",
    "Class",
    "Exam",
    "Score",
    "Total",
    "Percentage",
    "Date"
  ];

  const csvCell = value => {
    let text = String(value ?? "");

    // Prevent spreadsheet formula injection.
    if (/^[=+\-@]/.test(text)) {
      text = "'" + text;
    }

    return '"' + text.replace(/"/g, '""') + '"';
  };

  const rows = results.map(result => [
    result.student,
    result.className || "Class not recorded",
    result.exam,
    result.score,
    result.total,
    result.percentage + "%",
    result.submittedAt
  ]);

  const csv = [
    columns.map(csvCell).join(","),
    ...rows.map(row => row.map(csvCell).join(","))
  ].join("\r\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="cbt-results.csv"'
  );

  res.send("\uFEFF" + csv);
});
app.post("/api/retakes/:id/approve", requireAdmin, (req, res) => {
  const attempt = db.attempts.find(
    a => a.id === req.params.id && a.submitted
  );

  if (!attempt) return res.status(404).json({ error: "Submitted attempt not found." });

  attempt.retakeApproved = true;
  save();
  res.json({ ok: true });
});
// OFFLINE MODE: Administrator checks local synchronization status
app.get("/api/offline/sync-status", requireAdmin, (req, res) => {
  const pending = db.attempts.filter(
    attempt => attempt.submitted && !attempt.syncedAt
  );

  const synced = db.attempts.filter(
    attempt => attempt.submitted && attempt.syncedAt
  );

  res.json({
    mode: "offline-ready",
    pendingResults: pending.length,
    syncedResults: synced.length,
    totalSubmitted: pending.length + synced.length
  });
});// OFFLINE MODE: Export submitted results for backup
app.get("/api/offline/export-results", requireAdmin, (req, res) => {
  const results = db.attempts
    .filter(attempt => attempt.submitted && attempt.result)
    .map(attempt => ({
      attemptId: attempt.id,
      examId: attempt.examId,
      studentId: attempt.studentId,
      student: attempt.student,
      result: attempt.result,
      syncStatus: attempt.syncStatus || "pending",
      syncedAt: attempt.syncedAt || null
    }));

  const backup = {
    format: "cbt-hub-results-v1",
    exportedAt: new Date().toISOString(),
    results
  };

  res.setHeader(
    "Content-Disposition",
    'attachment; filename="cbt-hub-results-backup.json"'
  );
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(backup, null, 2));
});
// PHONE LOCAL NETWORK ADDRESS
app.get("/api/network", (req, res) => {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry && entry.family === "IPv4" && !entry.internal) {
        addresses.push({
          address: entry.address,
          url: `http://${entry.address}:${PORT}`
        });
      }
    }
  }

  res.setHeader("Cache-Control", "no-store");

  res.json({
    listening: "0.0.0.0",
       port: Number(PORT),
    localAddresses: addresses 
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.listen(PORT, "0.0.0.0", () => {
  console.log("CBT HUB running on port " + PORT);
});
