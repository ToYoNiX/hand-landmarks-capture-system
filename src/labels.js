export const REQUIRED = 50;

export const LABELS = [
  // ── Numbers ────────────────────────────────────────────────────────────────
  { ar: "واحد",    category: "Numbers",     type: "static",  mirrorable: true, videoUrl: null },
  { ar: "اثنان",   category: "Numbers",     type: "static",  mirrorable: false, videoUrl: null },
  { ar: "ثلاثة",   category: "Numbers",     type: "static",  mirrorable: false, videoUrl: null },
  { ar: "أربعة",   category: "Numbers",     type: "static",  mirrorable: false, videoUrl: null },
  { ar: "خمسة",    category: "Numbers",     type: "static",  mirrorable: false, videoUrl: null },
  { ar: "ستة",     category: "Numbers",     type: "static",  mirrorable: false, videoUrl: null },
  { ar: "سبعة",    category: "Numbers",     type: "static",  mirrorable: false, videoUrl: null },
  { ar: "ثمانية",  category: "Numbers",     type: "static",  mirrorable: false, videoUrl: null },
  { ar: "تسعة",    category: "Numbers",     type: "static",  mirrorable: false, videoUrl: null },
  { ar: "عشرة",    category: "Numbers",     type: "static",  mirrorable: false, videoUrl: null },

  // ── Greetings ──────────────────────────────────────────────────────────────
  { ar: "مرحبا",          category: "Greetings",   type: "dynamic", mirrorable: false, videoUrl: null },
  { ar: "السلام عليكم",   category: "Greetings",   type: "dynamic", mirrorable: false, videoUrl: null },
  { ar: "كيف حالك",       category: "Greetings",   type: "dynamic", mirrorable: false, videoUrl: null },
  { ar: "شكراً",          category: "Greetings",   type: "dynamic", mirrorable: false, videoUrl: null },
  { ar: "من فضلك",        category: "Greetings",   type: "dynamic", mirrorable: false, videoUrl: null },
  { ar: "آسف",            category: "Greetings",   type: "dynamic", mirrorable: false, videoUrl: null },
  { ar: "وداعاً",         category: "Greetings",   type: "dynamic", mirrorable: false, videoUrl: null },

  // ── Basic Words ────────────────────────────────────────────────────────────
  { ar: "نعم",  category: "Basic Words", type: "static",  mirrorable: false, videoUrl: null },
  { ar: "لا",   category: "Basic Words", type: "static",  mirrorable: false, videoUrl: null },
  { ar: "أنا",  category: "Basic Words", type: "static",  mirrorable: false, videoUrl: null },
  { ar: "أنت",  category: "Basic Words", type: "static",  mirrorable: false, videoUrl: null },
  { ar: "هو",   category: "Basic Words", type: "static",  mirrorable: false, videoUrl: null },
  { ar: "هي",   category: "Basic Words", type: "static",  mirrorable: false, videoUrl: null },
  { ar: "نحن",  category: "Basic Words", type: "static",  mirrorable: false, videoUrl: null },

  // ── Colors ─────────────────────────────────────────────────────────────────
  { ar: "أحمر", category: "Colors",      type: "static",  mirrorable: false, videoUrl: null },
  { ar: "أزرق", category: "Colors",      type: "static",  mirrorable: false, videoUrl: null },
  { ar: "أخضر", category: "Colors",      type: "static",  mirrorable: false, videoUrl: null },
  { ar: "أصفر", category: "Colors",      type: "static",  mirrorable: false, videoUrl: null },
  { ar: "أبيض", category: "Colors",      type: "static",  mirrorable: false, videoUrl: null },
  { ar: "أسود", category: "Colors",      type: "static",  mirrorable: false, videoUrl: null },
];

export const CATEGORIES = [...new Set(LABELS.map(l => l.category))];
