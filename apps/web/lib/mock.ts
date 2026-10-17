/* -----------------------------------------------------------------------------
 * Mock data for the shell.
 *
 * Deterministic on purpose: the same seed produces the same 2 000 patients in every browser and in CI, so
 * performance claims ("first page under a second") mean something. This module is deleted the moment the real
 * API lands (P0-301) — the grid talks to a query callback, so nothing else changes.
 */

export interface Patient {
  mrn: string;
  name: string;
  nameBn: string;
  age: number;
  sex: 'Male' | 'Female' | 'Other';
  phone: string;
  branch: string;
  payer: string;
  lastVisit: string;
  status: 'Active' | 'Admitted' | 'Discharged' | 'Follow-up';
  allergies: string;
}

export const branches = ['Main Campus', 'Uttara Branch', 'Mirpur Branch'] as const;
export const payers = ['Self pay', 'Corporate — BRAC', 'Insurance — MetLife', 'Govt. scheme'] as const;

const femaleNames = ['Fatema Begum', 'Nasrin Akter', 'Ruma Khatun', 'Shirin Sultana', 'Ayesha Siddika', 'Rehana Parvin'];
const maleNames = ['Abdul Karim', 'Mizanur Rahman', 'Shahidul Islam', 'Rafiqul Hasan', 'Jahangir Alam', 'Kamrul Hossain'];
const bnNames = ['ফাতেমা বেগম', 'নাসরিন আক্তার', 'রুমা খাতুন', 'শিরিন সুলতানা', 'আয়েশা সিদ্দিকা', 'রেহানা পারভীন',
  'আব্দুল করিম', 'মিজানুর রহমান', 'শহীদুল ইসলাম', 'রফিকুল হাসান', 'জাহাঙ্গীর আলম', 'কামরুল হোসেন'];
const statuses: Patient['status'][] = ['Active', 'Follow-up', 'Discharged', 'Admitted'];
const allergyPool = ['', '', '', '', 'Penicillin', 'Sulfa drugs', 'NSAIDs', 'Peanut'];

/** Deterministic pseudo-random generator (mulberry32) — no dependency, reproducible in CI. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOTAL = 2000;

export const patients: Patient[] = (() => {
  const rand = rng(20261014);
  return Array.from({ length: TOTAL }, (_, i) => {
    const female = rand() < 0.52;
    const pool = female ? femaleNames : maleNames;
    const name = pool[Math.floor(rand() * pool.length)];
    const nameBn = bnNames[(female ? femaleNames.indexOf(name) : femaleNames.length + maleNames.indexOf(name)) % bnNames.length];
    const age = 1 + Math.floor(rand() * 88);
    const day = 1 + Math.floor(rand() * 28);
    const month = 1 + Math.floor(rand() * 12);
    return {
      // MRN continuity: the legacy series is preserved, new registrations continue from it (plan 06 §2).
      mrn: `SH-${String(102_300 + i).padStart(6, '0')}`,
      name,
      nameBn,
      age,
      sex: female ? 'Female' : 'Male',
      phone: `01${7 + Math.floor(rand() * 3)}${String(Math.floor(rand() * 100_000_000)).padStart(8, '0')}`,
      branch: branches[Math.floor(rand() * branches.length)],
      payer: payers[Math.floor(rand() * payers.length)],
      lastVisit: `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      status: statuses[Math.floor(rand() * statuses.length)],
      allergies: allergyPool[Math.floor(rand() * allergyPool.length)],
    };
  });
})();

export interface Page<T> {
  rows: T[];
  total: number;
}

/**
 * Server-shaped query: filter → sort → page. The real API will do exactly this, server-side.
 *
 * Every parameter here is a filter the grid's *query* can carry (see `@dizi/ui`'s `grid.ts`), which is what makes the
 * patient register a saved view rather than a label: a view named "Admitted at Main Campus" is the two filters below
 * and can be applied, shared as a link and — when this function is replaced by a fetch — sent to the server unchanged.
 */
export function queryPatients(params: {
  page: number;
  pageSize: number;
  sort?: { key: string; dir: 'asc' | 'desc' };
  search?: string;
  branch?: string;
  status?: string;
  payer?: string;
}): Page<Patient> {
  const { page, pageSize, sort, search, branch, status, payer } = params;
  let rows = patients;

  if (search) {
    const q = search.trim().toLowerCase();
    rows = rows.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.nameBn.includes(search.trim()) ||
        p.mrn.toLowerCase().includes(q) ||
        p.phone.includes(q),
    );
  }
  if (branch) rows = rows.filter((p) => p.branch === branch);
  if (status) rows = rows.filter((p) => p.status === status);
  if (payer) rows = rows.filter((p) => p.payer === payer);

  if (sort) {
    const { key, dir } = sort;
    const sign = dir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const av = a[key as keyof Patient];
      const bv = b[key as keyof Patient];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign;
      return String(av).localeCompare(String(bv)) * sign;
    });
  }

  const start = (page - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), total: rows.length };
}

/** CSV export from what the grid currently shows — the counter staff's habit from the legacy system. */
export function toCsv<T>(rows: T[], columns: Array<{ key: keyof T & string; header: string }>): string {
  const escape = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map((c) => escape(c.header)).join(','), ...rows.map((r) => columns.map((c) => escape(r[c.key])).join(','))].join('\n');
}
