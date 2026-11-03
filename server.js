const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;
const DIR = path.join(__dirname, 'data');
const FILE = path.join(DIR, 'db.json');

fs.mkdirSync(DIR, { recursive: true });

const fresh = () => ({
  users: [],
  exams: [],
  attempts: [],
  settings: {}
});

let db;

try {
  db = JSON.parse(fs.readFileSync(FILE));
} catch {
  db = fresh();
}

const save = () => {
  const temp = FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(db, null, 2));
  fs.renameSync(temp, FILE);
};

const id = prefix =>
  prefix + '_' + Date.now().toString(36) +
  Math.random().toString(36).slice(2, 7);

app.use(express.json({ limit: '12mb' }));

app.use(session({
  name: 'cbthub.sid',
  secret: process.env.SESSION_SECRET || 'change-this-secret-before-use',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000
  }
}));

// Serve website files from the repository root.
app.use(express.static(__dirname));

const user = req =>
  db.users.find(x => x.id === req.session.uid);

const login = (req, res, next) => {
  if (user(req)) return next();
  return res.status(401).json({ error: 'Please sign in.' });
};

const teacher = (req, res, next) =>
  login(req, res, () => {
    if (['admin', 'teacher'].includes(user(req).role)) return next();
    return res.status(403).json({ error: 'Teacher access required.' });
  });

const admin = (req, res, next) =>
  login(req, res, () => {
    if (user(req).role === 'admin') return next();
    return res.status(403).json({ error: 'Admin only.' });
  });

const safe = u => ({
  id: u.id,
  username: u.username,
  role: u.role
});

// STATUS
app.get('/api/status', (req, res) => {
  res.json({
    setup: !db.users.some(x => x.role === 'admin'),
    user: user(req) ? safe(user(req)) : null
  });
});

// FIRST ADMIN SETUP
app.post('/api/setup', async (req, res) => {
  if (db.users.some(x => x.role === 'admin')) {
    return res.status(400).json({ error: 'Admin already created.' });
  }

  const { username, password } = req.body;

  if (
    !username ||
    username.trim().length < 3 ||
    !password ||
    password.length < 8
  ) {
    return res.status(400).json({
      error: 'Username needs 3 characters and password 8.'
    });
  }

  const u = {
    id: id('u'),
    username: username.trim(),
    passwordHash: await bcrypt.hash(password, 10),
    role: 'admin'
  };

  db.users.push(u);
  save();

  req.session.uid = u.id;

  res.json({ user: safe(u) });
});

// LOGIN
app.post('/api/login', async (req, res) => {
  const u = db.users.find(
    x => x.username.toLowerCase() ===
    String(req.body.username || '').trim().toLowerCase()
  );

  if (
    !u ||
    !await bcrypt.compare(
      String(req.body.password || ''),
      u.passwordHash
    )
  ) {
    return res.status(401).json({
      error: 'Wrong username or password.'
    });
  }

  req.session.uid = u.id;
  res.json({ user: safe(u) });
});

// LOGOUT
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// TEACHERS
app.get('/api/teachers', admin, (req, res) => {
  res.json(db.users.filter(x => x.role === 'teacher').map(safe));
});

app.post('/api/teachers', admin, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (username.length < 3 || password.length < 8) {
    return res.status(400).json({
      error: 'Username 3+ characters; password 8+.'
    });
  }

  if (db.users.some(
    x => x.username.toLowerCase() === username.toLowerCase()
  )) {
    return res.status(409).json({
      error: 'Username already exists.'
    });
  }

  const u = {
    id: id('u'),
    username,
    passwordHash: await bcrypt.hash(password, 10),
    role: 'teacher'
  };

  db.users.push(u);
  save();

  res.json({ user: safe(u) });
});

app.delete('/api/teachers/:id', admin, (req, res) => {
  db.users = db.users.filter(
    x => !(x.id === req.params.id && x.role === 'teacher')
  );

  save();
  res.json({ ok: true });
});

// LIST EXAMS
app.get('/api/exams', teacher, (req, res) => {
  res.json(
    db.exams
      .filter(e =>
        user(req).role === 'admin' ||
        e.creator === user(req).username
      )
      .map(e => ({
        id: e.id,
        title: e.title,
        code: e.code,
        duration: e.duration,
        bankSize: e.questions.length,
        questionCount: e.questionCount,
        creator: e.creator,
        running: e.running,
        paused: e.paused
      }))
  );
});

// CREATE EXAM
app.post('/api/exams', teacher, (req, res) => {
  const { title, duration, questionCount, questions } = req.body;

  if (
    !title ||
    !Array.isArray(questions) ||
    !questions.length ||
    questions.length > 1000
  ) {
    return res.status(400).json({
      error: 'Add a title and between 1 and 1000 bank questions.'
    });
  }

  const qs = questions.map(q => ({
    id: id('q'),
    text: String(q.text || '').trim(),
    options: (q.options || []).slice(0, 4).map(String),
    answer: +q.answer,
    image: q.image || '',
    diagram: q.diagram || ''
  }));

  if (qs.some(q =>
    !q.text ||
    q.options.length !== 4 ||
    q.options.some(x => !x.trim()) ||
    !Number.isInteger(q.answer) ||
    q.answer < 0 ||
    q.answer > 3
  )) {
    return res.status(400).json({
      error: 'Each question needs text, four options and a correct answer.'
    });
  }

  const count = Math.max(
    1,
    Math.min(qs.length, +questionCount || qs.length)
  );

  let code;

  do {
    code = Math.random().toString(36).slice(2, 8).toUpperCase();
  } while (db.exams.some(e => e.code === code));

  const e = {
    id: id('e'),
    title: String(title).trim(),
    code,
    duration: Math.max(1, Math.min(480, +duration || 30)),
    questionCount: count,
    questions: qs,
    creator: user(req).username,
    createdAt: new Date().toISOString(),
    running: false,
    paused: false,
    remaining: null,
    startedAt: null,
    activeStudents: []
  };

  db.exams.push(e);
  save();

  res.json({
    id: e.id,
    title: e.title,
    code: e.code,
    duration: e.duration,
    bankSize: qs.length,
    questionCount: count
  });
});

// DELETE EXAM
app.delete('/api/exams/:id', teacher, (req, res) => {
  const e = db.exams.find(x => x.id === req.params.id);

  if (!e) {
    return res.status(404).json({ error: 'Exam not found' });
  }

  if (
    user(req).role !== 'admin' &&
    e.creator !== user(req).username
  ) {
    return res.status(403).json({
      error: 'You can only delete your own exams'
    });
  }

  db.exams = db.exams.filter(x => x.id !== e.id);
  save();

  res.json({ ok: true });
});

// EXAM TIMER CONTROL
app.post('/api/exams/:id/control', admin, (req, res) => {
  const e = db.exams.find(x => x.id === req.params.id);

  if (!e) {
    return res.status(404).json({ error: 'Exam not found' });
  }

  const action = req.body.action;

  if (action === 'start') {
    e.running = true;
    e.paused = false;
    e.startedAt = Date.now();
    e.remaining = e.duration * 60;
  } else if (action === 'pause') {
    if (e.running && !e.paused) {
      e.remaining = Math.max(
        0,
        e.remaining - Math.floor((Date.now() - e.startedAt) / 1000)
      );
      e.paused = true;
    }
  } else if (action === 'resume') {
    if (e.running && e.paused) {
      e.startedAt = Date.now();
      e.paused = false;
    }
  } else if (action === 'stop') {
    e.running = false;
    e.paused = true;
    e.remaining = 0;
  } else {
    return res.status(400).json({ error: 'Unknown timer action' });
  }

  save();

  res.json({
    running: e.running,
    paused: e.paused,
    remaining: e.remaining
  });
});

// RESULTS
app.get('/api/results', teacher, (req, res) => {
  res.json(
    db.attempts.filter(a =>
      user(req).role === 'admin' ||
      a.creator === user(req).username
    )
  );
});

// STUDENT START EXAM
app.post('/api/exam/start', (req, res) => {
  const e = db.exams.find(
    x => x.code === String(req.body.code || '').trim().toUpperCase()
  );

  if (!e) {
    return res.status(404).json({ error: 'Exam code not found' });
  }

  const name = String(req.body.name || '').trim();

  if (name.length < 2) {
    return res.status(400).json({ error: 'Enter your full name' });
  }

  const old = db.attempts.find(
    a => a.examId === e.id &&
    a.student.toLowerCase() === name.toLowerCase()
  );

  if (old?.submitted) {
    return res.status(403).json({
      error: 'This student has already submitted. Ask the administrator if a retake is needed.'
    });
  }

  let active = e.activeStudents.find(
    x => x.name.toLowerCase() === name.toLowerCase()
  );

  if (active && !active.approved) {
    return res.status(403).json({
      error: 'Re-entry request sent. Wait for administrator approval.'
    });
  }

  if (!active) {
    active = {
      id: id('candidate'),
      name,
      approved: true,
      enteredAt: new Date().toISOString()
    };

    e.activeStudents.push(active);
  }

  const shuffled = [...e.questions]
    .sort(() => Math.random() - 0.5)
    .slice(0, e.questionCount);

  save();

  res.json({
    examId: e.id,
    candidateId: active.id,
    title: e.title,
    duration: e.duration,
    questionCount: e.questionCount,
    questions: shuffled.map(q => ({
      id: q.id,
      text: q.text,
      options: q.options,
      image: q.image,
      diagram: q.diagram
    })),
    timer: {
      running: e.running,
      paused: e.paused,
      remaining: e.remaining ?? e.duration * 60
    }
  });
});

// STUDENT LEAVES EXAM
app.post('/api/exam/leave', (req, res) => {
  const e = db.exams.find(x => x.id === req.body.examId);
  const c = e?.activeStudents.find(
    x => x.id === req.body.candidateId
  );

  if (!c) {
    return res.status(404).json({ error: 'Candidate not found' });
  }

  c.approved = false;
  c.requestedAt = new Date().toISOString();

  save();

  res.json({
    ok: true,
    message: 'Re-entry requires administrator approval.'
  });
});

// PENDING RE-ENTRY REQUESTS
app.get('/api/pending', admin, (req, res) => {
  res.json(
    db.exams.flatMap(e =>
      e.activeStudents
        .filter(c => !c.approved)
        .map(c => ({
          examId: e.id,
          examTitle: e.title,
          candidateId: c.id,
          name: c.name,
          requestedAt: c.requestedAt
        }))
    )
  );
});

// APPROVE RE-ENTRY
app.post('/api/approve', admin, (req, res) => {
  const e = db.exams.find(x => x.id === req.body.examId);
  const c = e?.activeStudents.find(
    x => x.id === req.body.candidateId
  );

  if (!c) {
    return res.status(404).json({ error: 'Request not found' });
  }

  c.approved = true;
  save();

  res.json({ ok: true });
});

// SUBMIT EXAM
app.post('/api/exam/submit', (req, res) => {
  const e = db.exams.find(x => x.id === req.body.examId);
  const c = e?.activeStudents.find(
    x => x.id === req.body.candidateId
  );

  if (!e || !c) {
    return res.status(404).json({
      error: 'Exam session not found'
    });
  }

  if (db.attempts.some(a =>
    a.examId === e.id &&
    a.student.toLowerCase() === c.name.toLowerCase() &&
    a.submitted
  )) {
    return res.status(409).json({ error: 'Already submitted' });
  }

  const answers = req.body.answers || {};

  const score = e.questions.filter(q =>
    Object.prototype.hasOwnProperty.call(answers, q.id) &&
    +answers[q.id] === q.answer
  ).length;

  const result = {
    id: id('result'),
    examId: e.id,
    examTitle: e.title,
    examCode: e.code,
    student: c.name,
    score,
    total: e.questionCount,
    percentage: Math.round(score / e.questionCount * 100),
    creator: e.creator,
    submitted: true,
    submittedAt: new Date().toISOString()
  };

  db.attempts.push(result);
  save();

  res.json({
    score,
    total: e.questionCount,
    percentage: result.percentage
  });
});

// CHECK TIMER
app.get('/api/timer/:id', (req, res) => {
  const e = db.exams.find(x => x.id === req.params.id);

  if (!e) {
    return res.status(404).json({ error: 'Exam not found' });
  }

  let remain = e.remaining ?? e.duration * 60;

  if (e.running && !e.paused) {
    remain = Math.max(
      0,
      remain - Math.floor((Date.now() - e.startedAt) / 1000)
    );
  }

  res.json({
    running: e.running,
    paused: e.paused,
    remaining: remain
  });
});

// Load the homepage from the repository root.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`CBT HUB running on port ${PORT}`);

  for (const arr of Object.values(os.networkInterfaces())) {
    for (const n of arr || []) {
      if (n.family === 'IPv4' && !n.internal) {
        console.log(`Students use: http://${n.address}:${PORT}`);
      }
    }
  }
});
