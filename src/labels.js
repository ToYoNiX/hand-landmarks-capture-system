export const REQUIRED = 50;

export const LABELS = [
  // ── Numbers ────────────────────────────────────────────────────────────────
  { ar: "واحد",    category: "الارقام",     type: "static",  mirrorable: true, videoUrl: null },
  { ar: "اثنان",   category: "الارقام",     type: "static",  mirrorable: true, videoUrl: null },
  { ar: "ثلاثة",   category: "الارقام",     type: "static",  mirrorable: true, videoUrl: null },
  { ar: "أربعة",   category: "الارقام",     type: "static",  mirrorable: true, videoUrl: null },
  { ar: "خمسة",    category: "الارقام",     type: "static",  mirrorable: true, videoUrl: null },
  { ar: "ستة",     category: "الارقام",     type: "static",  mirrorable: true, videoUrl: null },
  { ar: "سبعة",    category: "الارقام",     type: "static",  mirrorable: true, videoUrl: null },
  { ar: "ثمانية",  category: "الارقام",     type: "static",  mirrorable: true, videoUrl: null },
  { ar: "تسعة",    category: "الارقام",     type: "static",  mirrorable: true, videoUrl: null },
  { ar: "عشرة",    category: "الارقام",     type: "static",  mirrorable: true, videoUrl: null },

  // ── Letters ────────────────────────────────────────────────────────────────
  { ar: "ا", category: "الحروف", type: "static", mirrorable: true, videoUrl: null },
  { ar: "ب", category: "الحروف", type: "static", mirrorable: true, videoUrl: null },
  { ar: "ت", category: "الحروف", type: "static", mirrorable: true, videoUrl: null },
  { ar: "ث", category: "الحروف", type: "static", mirrorable: true, videoUrl: null },
  { ar: "ج", category: "الحروف", type: "static", mirrorable: true, videoUrl: null },
  { ar: "ح", category: "الحروف", type: "static", mirrorable: true, videoUrl: null },
  { ar: "خ", category: "الحروف", type: "static", mirrorable: true, videoUrl: null },
  { ar: "د", category: "الحروف", type: "static", mirrorable: true, videoUrl: null },
  { ar: "ذ", category: "الحروف", type: "static", mirrorable: true, videoUrl: null },
  { ar: "ر", category: "الحروف", type: "static", mirrorable: true, videoUrl: null },
  { ar: "ز", category: "الحروف", type: "static", mirrorable: true, videoUrl: null },
  { ar: "س", category: "الحروف", type: "static", mirrorable: true, videoUrl: null },
  { ar: "ش", category: "الحروف", type: "static", mirrorable: true, videoUrl: null },
  { ar: "ص", category: "الحروف", type: "static", mirrorable: true, videoUrl: null },
  { ar: "ض", category: "الحروف", type: "static", mirrorable: true, videoUrl: null },
  { ar: "ط", category: "الحروف", type: "static", mirrorable: true, videoUrl: null },
  { ar: "ظ", category: "الحروف", type: "static", mirrorable: true, videoUrl: null },
  { ar: "ع", category: "الحروف", type: "static", mirrorable: true, videoUrl: null },
  { ar: "غ", category: "الحروف", type: "static", mirrorable: true, videoUrl: null },
  { ar: "ف", category: "الحروف", type: "static", mirrorable: true, videoUrl: null },
  { ar: "ق", category: "الحروف", type: "static", mirrorable: true, videoUrl: null },
  { ar: "ك", category: "الحروف", type: "static", mirrorable: true, videoUrl: null },
  { ar: "ل", category: "الحروف", type: "static", mirrorable: true, videoUrl: null },
  { ar: "م", category: "الحروف", type: "static", mirrorable: true, videoUrl: null },
  { ar: "ن", category: "الحروف", type: "static", mirrorable: true, videoUrl: null },
  { ar: "ه", category: "الحروف", type: "static", mirrorable: true, videoUrl: null },
  { ar: "و", category: "الحروف", type: "static", mirrorable: true, videoUrl: null },
  { ar: "ي", category: "الحروف", type: "static", mirrorable: true, videoUrl: null },
];

export const CATEGORIES = [...new Set(LABELS.map(l => l.category))];
