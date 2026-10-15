/* ----------------------------------------------------------------------------------------------------
 * Front CMS (P8) — the public website, as content rather than as a file on somebody's desktop.
 *
 * The website is the hospital's front door for people who have never been inside it: somebody looking for the outdoor
 * clinic times, somebody checking whether the emergency department is open, somebody reading a notice about the
 * vaccination day. Three rules follow from who is reading:
 *
 *  1. **Bangla first, English beside it.** Every patient-facing page carries both, and the Bangla is the one written
 *     first. A page with only English is refused rather than published: half the people who need it cannot read it.
 *  2. **A published page is a promise about a telephone number and an opening time.** Those facts are rendered from
 *     the branch register rather than typed into the page, so the website and the front desk cannot disagree.
 *  3. **A page is content, not markup.** The editor writes headings, paragraphs, lists and key/value facts with four
 *     markers (`## `, `- `, `key: value`, blank line), the parser turns them into blocks, and the renderer draws the
 *     blocks. Nothing is pasted in from a word processor, which is how a hospital site ends up with six fonts.
 *
 * The site in this app is a preview rendered from these same records: `/site` and `/site/<slug>`. A real deployment
 * serves the identical blocks through whatever renders the menu and the sitemap; the records do not change.
 */

export type SiteSection = 'home' | 'about' | 'departments' | 'doctors' | 'services' | 'news' | 'notice' | 'careers' | 'contact';
export type PageState = 'draft' | 'published' | 'retired';

export interface SectionSpec {
  section: SiteSection;
  slug: string;
  label: string;
  labelBn: string;
  /** Whether the page is written for patients, or for patients and staff both. */
  audience: 'patients' | 'both' | 'staff';
  purpose: string;
}

export const SECTIONS: SectionSpec[] = [
  { section: 'home', slug: '', label: 'Home', labelBn: 'প্রথম পাতা', audience: 'patients', purpose: 'The first page: what the hospital is, where it is, what it treats, and how to reach a person.' },
  { section: 'about', slug: 'about', label: 'About', labelBn: 'পরিচিতি', audience: 'patients', purpose: 'Who runs it, how big it is, what it is registered to do, and what it does not do. Saying what is not offered is part of being useful.' },
  { section: 'departments', slug: 'departments', label: 'Departments', labelBn: 'বিভাগসমূহ', audience: 'patients', purpose: 'One page per department with its outdoor days, drawn from the department register rather than retyped.' },
  { section: 'doctors', slug: 'doctors', label: 'Doctors', labelBn: 'চিকিৎসক', audience: 'patients', purpose: 'Who sits in which chamber, on which days — from the duty roster, so a doctor on leave is not advertised.' },
  { section: 'services', slug: 'services', label: 'Services and prices', labelBn: 'সেবা ও মূল্য', audience: 'patients', purpose: 'What a visit, a test, a cabin or an ambulance costs, from the billing master list.' },
  { section: 'news', slug: 'news', label: 'News', labelBn: 'খবর', audience: 'patients', purpose: 'Camps, drives, new equipment and public-health notices the hospital is running.' },
  { section: 'notice', slug: 'notice', label: 'Notices', labelBn: 'নোটিশ', audience: 'both', purpose: 'Dated announcements: closures, changes to outdoor hours, holiday arrangements. A notice without a date is not published.' },
  { section: 'careers', slug: 'careers', label: 'Careers', labelBn: 'কর্মসংস্থান', audience: 'both', purpose: 'Vacancies and how to apply, from the recruitment register. A filled post stops being advertised that day.' },
  { section: 'contact', slug: 'contact', label: 'Contact', labelBn: 'যোগাযোগ', audience: 'patients', purpose: 'Telephone numbers, addresses, hours and the way to get there — every one of them rendered from the branch register.' },
];

export const sectionFor = (section: SiteSection): SectionSpec => SECTIONS.find((s) => s.section === section) ?? SECTIONS[0];
export const sectionBySlug = (slug: string): SectionSpec | undefined => SECTIONS.find((s) => s.slug === slug);

/* ------------------------------------------------------------------------------ the block grammar */

export type BlockKind = 'heading' | 'paragraph' | 'list' | 'facts' | 'notice' | 'callout';

export interface SiteBlock {
  kind: BlockKind;
  en: string;
  bn: string;
  /** Key/value rows for `facts`, items for `list`. */
  rows?: Array<{ en: string; bn: string }>;
  /** A date, on a notice: the reason a notice can be trusted a year later. */
  on?: string;
}

export const MARKERS: Array<{ marker: string; kind: BlockKind; because: string }> = [
  { marker: '## ', kind: 'heading', because: 'A section heading. Headings are what a reader skimming on a phone actually reads.' },
  { marker: '- ', kind: 'list', because: 'A list of short lines. Anything a person reads aloud on the telephone should be a list.' },
  { marker: 'key: value', kind: 'facts', because: 'A row of a facts table: `Outdoor hours: 08:00–20:00`. Keys are unique inside one block, because two different answers to one question is worse than none.' },
  { marker: '> ', kind: 'notice', because: 'A dated callout. A notice block carries a date and the check refuses one without it.' },
  { marker: '(blank line)', kind: 'paragraph', because: 'Anything else is a paragraph. Pressing Enter twice starts a new one.' },
  { marker: '! ', kind: 'callout', because: 'A warning the reader must not miss — a change of address, a closure, an emergency number.' },
];

/**
 * The parser behind the editor's live preview and behind the site renderer.
 *
 * One function, used twice: if the editor previewed the page with different code from the one the site draws, the
 * preview would be a drawing of the page rather than the page, and the first thing anybody would notice is a
 * difference in the published version.
 */
export function parseBody(text: string, lang: 'en' | 'bn'): SiteBlock[] {
  const blocks: SiteBlock[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: string[] = [];
  let facts: Array<{ key: string; value: string }> = [];
  let notice: string[] = [];

  const flush = () => {
    if (paragraph.length) {
      const joined = paragraph.join(' ').trim();
      blocks.push({ kind: 'paragraph', en: lang === 'en' ? joined : '', bn: lang === 'bn' ? joined : '' });
      paragraph = [];
    }
    if (list.length) {
      blocks.push({ kind: 'list', en: '', bn: '', rows: list.map((l) => (lang === 'en' ? { en: l, bn: '' } : { en: '', bn: l })) });
      list = [];
    }
    if (facts.length) {
      blocks.push({ kind: 'facts', en: '', bn: '', rows: facts.map((f) => (lang === 'en' ? { en: `${f.key}: ${f.value}`, bn: '' } : { en: '', bn: `${f.key}: ${f.value}` })) });
      facts = [];
    }
    if (notice.length) {
      const joined = notice.join(' ').trim();
      blocks.push({ kind: 'notice', en: lang === 'en' ? joined : '', bn: lang === 'bn' ? joined : '' });
      notice = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    if (line.startsWith('## ')) {
      flush();
      blocks.push({ kind: 'heading', en: lang === 'en' ? line.slice(3).trim() : '', bn: lang === 'bn' ? line.slice(3).trim() : '' });
      continue;
    }
    if (line.startsWith('! ')) {
      flush();
      blocks.push({ kind: 'callout', en: lang === 'en' ? line.slice(2).trim() : '', bn: lang === 'bn' ? line.slice(2).trim() : '' });
      continue;
    }
    if (line.startsWith('> ')) {
      if (paragraph.length || list.length || facts.length) flush();
      notice.push(line.slice(2).trim());
      continue;
    }
    if (line.startsWith('- ')) {
      if (paragraph.length || facts.length || notice.length) flush();
      list.push(line.slice(2).trim());
      continue;
    }
    const fact = /^([^:]{2,40}):\s*(.+)$/.exec(line);
    if (fact && !line.endsWith('.')) {
      if (paragraph.length || list.length || notice.length) flush();
      facts.push({ key: fact[1].trim(), value: fact[2].trim() });
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

/** The other direction, so the editor can be opened on a page and written back into the same text. */
export function serialiseBody(blocks: SiteBlock[], lang: 'en' | 'bn'): string {
  const pick = (b: SiteBlock) => (lang === 'en' ? b.en : b.bn);
  return blocks
    .map((b) => {
      const text = pick(b);
      if (b.kind === 'heading') return `## ${text}`;
      if (b.kind === 'callout') return `! ${text}`;
      if (b.kind === 'notice') return `> ${text}`;
      if (b.kind === 'list') return (b.rows ?? []).map((r) => `- ${lang === 'en' ? r.en : r.bn}`).join('\n');
      if (b.kind === 'facts') return (b.rows ?? []).map((r) => (lang === 'en' ? r.en : r.bn)).join('\n');
      return text;
    })
    .join('\n\n');
}

/* ------------------------------------------------------------------------------ the pages */

export interface CmsPage {
  slug: string;
  section: SiteSection;
  titleEn: string;
  titleBn: string;
  bodyEn: string;
  bodyBn: string;
  state: PageState;
  /** Who wrote the version that is live, and when. Both are shown on the public page. */
  author: string;
  updatedAt: string;
  publishedAt?: string;
  /** The revision the public page is rendering. Publishing is an act; editing is not. */
  revision: number;
}

const page = (
  slug: string,
  section: SiteSection,
  titleEn: string,
  titleBn: string,
  bodyEn: string,
  bodyBn: string,
  state: PageState,
  author: string,
  updatedAt: string,
  publishedAt?: string,
  revision = 1,
): CmsPage => ({ slug, section, titleEn, titleBn, bodyEn, bodyBn, state, author, updatedAt, publishedAt, revision });

export const CMS_PAGES: CmsPage[] = [
  page(
    '',
    'home',
    'Dizi Hospital — Main Campus',
    'ডিজি হসপিটাল — প্রধান ক্যাম্পাস',
    `## A hospital in Dhaka that answers the telephone
Dizi Hospital has been treating patients at the Main Campus since 1998: emergency care that never closes, an outdoor clinic six days a week, a laboratory, a pharmacy and 236 beds.
! The emergency department is open 24 hours, every day of the year. Telephone 02 9876 500.
## What we treat
- Emergency and accident care, day and night
- Medicine, surgery, obstetrics and child health
- Diabetes and the diabetic foot clinic
- Laboratory, ultrasonography and X-ray, in the same building
## Where we are
Main Campus: 22 Green Road, Dhaka 1205. Two smaller branches, Uttara and Mirpur, for outdoor visits, the laboratory and the pharmacy.
Telephone: 02 9876 540 (desk, 08:00–20:00)
Emergency: 02 9876 500 (24 hours)`,
    `## ঢাকার একটি হাসপাতাল, যেখানে ফোন ধরা হয়
১৯৯৮ সাল থেকে ডিজি হসপিটালের প্রধান ক্যাম্পাসে রোগী দেখা হয়: জরুরি বিভাগ কখনো বন্ধ হয় না, বহির্বিভাগ সপ্তাহে ছয় দিন চলে, সঙ্গে ল্যাব, ফার্মেসি ও ২৩৬টি শয্যা।
! জরুরি বিভাগ বছরভর চব্বিশ ঘণ্টা খোলা। ফোন: ০২ ৯৮৭৬ ৫০০।
## আমরা কী চিকিৎসা করি
- জরুরি ও দুর্ঘটনা বিভাগ, দিন-রাত
- মেডিসিন, সার্জারি, প্রসূতি ও শিশু স্বাস্থ্য
- ডায়াবেটিস ও ডায়াবেটিক ফুট ক্লিনিক
- একই ভবনে ল্যাব, আল্ট্রাসনোগ্রাফি ও এক্স-রে
## আমাদের ঠিকানা
প্রধান ক্যাম্পাস: ২২ গ্রিন রোড, ঢাকা ১২০৫। উত্তরা ও মিরপুর — এই দুই শাখায় বহির্বিভাগ, ল্যাব ও ফার্মেসি।
টেলিফোন: ০২ ৯৮৭৬ ৫৪০ (ডেস্ক, সকাল ৮টা–রাত ৮টা)
জরুরি: ০২ ৯৮৭৬ ৫০০ (চব্বিশ ঘণ্টা)`,
    'published',
    'R. Howlader',
    '2026-10-12',
    '2026-10-12 09:20',
    7,
  ),
  page(
    'about',
    'about',
    'About the hospital',
    'হাসপাতাল সম্পর্কে',
    `## Founded in 1998, still run by the family that started it
The Main Campus opened with 40 beds in a converted clinic on Green Road. It has grown to 236 beds, three operating theatres and a laboratory that runs its own quality checks.
## What we are registered to do
- 236 inpatient beds, 6 intensive-care beds, 4 high-dependency beds
- Emergency and accident care
- Obstetric care including caesarean sections
- Neonatal care for babies over 1.5 kg
## What we are not
We are not a cardiac surgery or transplant centre, and we do not treat burns beyond first aid. Patients who need those are stabilised here and transferred with a written handover, and we will telephone the receiving hospital in front of you rather than leave you to find it.`,
    `## ১৯৯৮ সালে শুরু, আজও সেই পরিবারের হাতেই
গ্রিন রোডের একটি ছোট ক্লিনিক থেকে ৪০ শয্যা নিয়ে প্রধান ক্যাম্পাসের যাত্রা। এখন ২৩৬ শয্যা, তিনটি অপারেশন থিয়েটার এবং নিজস্ব মান-পরীক্ষা করা একটি ল্যাব।
## আমরা কী কী করার অনুমোদন পেয়েছি
- ২৩৬টি শয্যা, ৬টি আইসিইউ, ৪টি এইচডিইউ
- জরুরি ও দুর্ঘটনা সেবা
- প্রসূতি সেবা, সিজারিয়ান সহ
- দেড় কেজির বেশি ওজনের নবজাতকের সেবা
## আমরা কী করি না
আমরা হৃদযন্ত্রের অস্ত্রোপচার বা অঙ্গ প্রতিস্থাপন করি না, এবং প্রাথমিক চিকিৎসার বাইরে পোড়ার চিকিৎসা করি না। যাঁদের সেসব দরকার, তাঁদের এখানে স্থিতিশীল করে লিখিত হ্যান্ডওভার সহ পাঠানো হয় — এবং গ্রহণকারী হাসপাতালে ফোনটা আপনার সামনেই করা হয়, আপনাকে খুঁজতে পাঠানো হয় না।`,
    'published',
    'M. Hoque',
    '2026-09-30',
    '2026-09-30 11:05',
    3,
  ),
  page(
    'departments',
    'departments',
    'Departments and outdoor days',
    'বিভাগসমূহ ও বহির্বিভাগের দিন',
    `## Outdoor clinic
The outdoor clinic runs Saturday to Thursday, 08:00–20:00. Tokens are given from 08:00 and the last token is given at 18:30, so that nobody is waiting when the pharmacy closes.
Outdoor hours: 08:00–20:00, Saturday to Thursday
- Medicine — Sunday, Tuesday, Thursday, from 09:00, Dr. S. Rahman, OPD-1
- Surgery — Saturday, Monday, Wednesday, from 09:00, Dr. T. Hossain, OPD-2
- Obstetrics and antenatal — every day from 08:30, Dr. R. Akter, OPD-4
- Child health — Saturday to Wednesday, from 09:30, Dr. T. Hossain, OPD-3
- Diabetes and foot clinic — Tuesday from 14:00, Dr. N. Islam, OPD-2
- Orthopaedics — Monday and Wednesday from 10:00, Dr. N. Islam, OPD-5
## Inpatient
Beds are allotted by the ward, not by the doctor: the duty medical officer decides on the day, and the ward desk tells you the bed number.`,
    `## বহির্বিভাগ
বহির্বিভাগ শনিবার থেকে বৃহস্পতিবার, সকাল ৮টা–রাত ৮টা। টোকেন সকাল ৮টা থেকে দেওয়া হয়, শেষ টোকেন সন্ধ্যা ৬:৩০-এ — যাতে ফার্মেসি বন্ধ হওয়ার সময় কেউ অপেক্ষায় না থাকে।
বহির্বিভাগের সময়: সকাল ৮টা–রাত ৮টা, শনি–বৃহস্পতি
- মেডিসিন — রবি, মঙ্গল, বৃহস্পতি, সকাল ৯টা থেকে, ডা. এস. রহমান, ওপিডি-১
- সার্জারি — শনি, সোম, বুধ, সকাল ৯টা থেকে, ডা. টি. হোসেন, ওপিডি-২
- প্রসূতি ও এএনসি — প্রতি দিন সকাল ৮:৩০ থেকে, ডা. আর. আক্তার, ওপিডি-৪
- শিশু স্বাস্থ্য — শনি থেকে বুধ, সকাল ৯:৩০ থেকে, ডা. টি. হোসেন, ওপিডি-৩
- ডায়াবেটিস ও ফুট ক্লিনিক — মঙ্গলবার দুপুর ২টা থেকে, ডা. এন. ইসলাম, ওপিডি-২
- অর্থোপেডিক — সোম ও বুধ সকাল ১০টা থেকে, ডা. এন. ইসলাম, ওপিডি-৫
## অন্তঃবিভাগ
শয্যা ওয়ার্ড থেকে দেওয়া হয়, ডাক্তার থেকে নয়: কোন রোগী কোন শয্যায়, তা সেই দিনের ডিউটি মেডিকেল অফিসার ঠিক করেন, আর ওয়ার্ড ডেস্ক আপনাকে শয্যা নম্বর জানায়।`,
    'published',
    'M. Hoque',
    '2026-10-05',
    '2026-10-05 15:40',
    4,
  ),
  page(
    'services',
    'services',
    'Services and prices',
    'সেবা ও মূল্য',
    `## What a visit costs
Prices are set by the branch and are the same at the counter and on this page, because both read the same list.
Outdoor ticket — consultant: ৳ 800
Outdoor ticket — registrar: ৳ 500
Emergency registration: ৳ 500, waived for accident cases brought by ambulance
Cabin — single, per day: ৳ 5 000
Ambulance — within Dhaka: ৳ 1 500
! Bring the money you expect to need, or ask at the desk about paying by card. Nothing is refused for want of payment, and the billing desk will explain a bill line by line.
## What is not included
Operation charges, medicines, blood, implants and investigations are billed separately from the ticket. An estimate is written down before an operation and given to the patient and the family; if the estimate has to change, the reason is explained before anything is done.`,
    `## এক ভিজিটে কত খরচ
দাম শাখা ঠিক করে, এবং কাউন্টারে ও এই পাতায় একই থাকে — কারণ দুটোই একই তালিকা পড়ে।
বহির্বিভাগের টিকিট — কনসালট্যান্ট: ৳ ৮০০
বহির্বিভাগের টিকিট — রেজিস্ট্রার: ৳ ৫০০
জরুরি বিভাগে নিবন্ধন: ৳ ৫০০, অ্যাম্বুলেন্সে আনা দুর্ঘটনার রোগীর ক্ষেত্রে মাফ
কেবিন — একক, প্রতিদিন: ৳ ৫ ০০০
অ্যাম্বুলেন্স — ঢাকার ভিতরে: ৳ ১ ৫০০
! যে টাকার দরকার হবে, সঙ্গে আনুন; অথবা ডেস্কে কার্ডে দেওয়ার কথা জিজ্ঞেস করুন। টাকার অভাবে কোনো সেবা আটকানো হয় না, আর বিলিং ডেস্ক প্রতিটি লাইন বুঝিয়ে বলবে।
## যেগুলো এর মধ্যে নেই
অপারেশনের খরচ, ঔষধ, রক্ত, ইমপ্ল্যান্ট ও পরীক্ষা — এগুলো টিকিটের বাইরে আলাদা বিল হয়। অপারেশনের আগে আনুমানিক খরচ লিখে রোগী ও পরিবারকে দেওয়া হয়; খরচ বদলাতে হলে কেন বদলাচ্ছে, সেটি কোনো কিছু করার আগেই বলা হয়।`,
    'published',
    'R. Howlader',
    '2026-10-09',
    '2026-10-09 10:15',
    5,
  ),
  page(
    'doctors',
    'doctors',
    'Doctors and chambers',
    'চিকিৎসক ও চেম্বার',
    `## The chamber list
This list comes from the duty roster. A doctor who is on leave is removed from it the day the leave is approved, so that nobody travels across the city for a chamber that is not being held.
- Dr. S. Rahman — Medicine, Sunday and Tuesday, 09:00
- Dr. T. Hossain — Surgery and child health, Saturday to Wednesday
- Dr. R. Akter — Obstetrics, every day 08:30
- Dr. N. Islam — Orthopaedics and the diabetic foot clinic, Monday, Tuesday and Wednesday
- Dr. K. Barua — Eye clinic, Monday 10:00
## Specialists who visit
A cardiologist holds a chamber on the first and third Friday, and a nephrologist on the second Saturday. Appointments are taken at the desk only, because the visiting list is confirmed by telephone a day in advance.`,
    `## চেম্বারের তালিকা
এই তালিকা ডিউটি রোস্টার থেকে আসে। ছুটি অনুমোদনের দিনই সংশ্লিষ্ট ডাক্তারের নাম তালিকা থেকে বাদ পড়ে — যাতে চেম্বার না বসার দিনে কেউ শহর ছেড়ে এসে ফিরে না যায়।
- ডা. এস. রহমান — মেডিসিন, রবিবার ও মঙ্গলবার, সকাল ৯টা
- ডা. টি. হোসেন — সার্জারি ও শিশু স্বাস্থ্য, শনি থেকে বুধ
- ডা. আর. আক্তার — প্রসূতি, প্রতি দিন সকাল ৮:৩০
- ডা. এন. ইসলাম — অর্থোপেডিক ও ডায়াবেটিক ফুট ক্লিনিক, সোম, মঙ্গল ও বুধ
- ডা. কে. বড়ুয়া — চোখের ক্লিনিক, সোমবার সকাল ১০টা
## যাঁরা বাইরে থেকে আসেন
একজন কার্ডিওলজিস্ট প্রতি মাসের প্রথম ও তৃতীয় শুক্রবার চেম্বার করেন, একজন নেফ্রোলজিস্ট দ্বিতীয় শনিবার। এঁদের জন্য সময় শুধু ডেস্ক থেকে নেওয়া হয়, কারণ তালিকা আগের দিন ফোনে নিশ্চিত করা হয়।`,
    'published',
    'M. Hoque',
    '2026-09-28',
    '2026-09-28 16:20',
    2,
  ),
  page(
    'notice',
    'notice',
    'Notices and closures',
    'নোটিশ ও বন্ধের সময়',
    `> 2026-10-16 — The outdoor clinic at the Main Campus will be closed on Friday 23 October for the annual electrical servicing. The emergency department, the laboratory and the pharmacy stay open all day. Uttara branch will hold outdoor from 09:00 to 13:00.
> 2026-10-10 — The child vaccination clinic has moved from Wednesday to Saturday, same hours: 09:00 to 13:00, Room OPD-3. Bring the vaccination card.
> 2026-10-02 — The diabetic foot clinic now runs twice a week, Tuesday at 14:00 and Thursday at 14:00, because the Tuesday list had grown to a six-week wait.
> 2026-09-24 — Blood donation camp in the hospital car park on Friday 2 October, 09:00 to 14:00, with the Sandhani volunteers. No appointment needed; bring a photograph or an identity card.
## How to ask about a notice
Telephone the desk on 02 9876 540. An old notice is kept on this page with its date rather than deleted, because people arrive holding a telephone number from a notice that has changed.`,
    `> ২০২৬-১০-১৬ — বার্ষিক বৈদ্যুতিক সার্ভিসিংয়ের জন্য ২৩ অক্টোবর শুক্রবার প্রধান ক্যাম্পাসে বহির্বিভাগ বন্ধ থাকবে। জরুরি বিভাগ, ল্যাব ও ফার্মেসি সারা দিন খোলা থাকবে। উত্তরা শাখায় বহির্বিভাগ সকাল ৯টা থেকে দুপুর ১টা।
> ২০২৬-১০-১০ — শিশু টিকাদান ক্লিনিক বুধবার থেকে শনিবারে সরানো হয়েছে, সময় আগের মতোই: সকাল ৯টা থেকে দুপুর ১টা, রুম ওপিডি-৩। টিকা কার্ড আনুন।
> ২০২৬-১০-০২ — ডায়াবেটিক ফুট ক্লিনিক সপ্তাহে দুই দিন চালু হলো, মঙ্গলবার ও বৃহস্পতিবার দুপুর ২টা — কারণ মঙ্গলবারের তালিকায় ছয় সপ্তাহের অপেক্ষা তৈরি হয়েছিল।
> ২০২৬-০৯-২৪ — আগামী ২ অক্টোবর শুক্রবার সকাল ৯টা থেকে দুপুর ২টা পর্যন্ত হাসপাতালের পার্কিংয়ে রক্তদান শিবির, সন্ধানী স্বেচ্ছাসেবকদের সঙ্গে। আগাম সময় নেওয়ার দরকার নেই; ছবি বা পরিচয়পত্র আনুন।
## নোটিশ নিয়ে জিজ্ঞেস করবেন যেভাবে
ডেস্কে ফোন করুন ০২ ৯৮৭৬ ৫৪০। পুরনো নোটিশ মুছে না দিয়ে তারিখ সহ রাখা হয়, কারণ অনেকেই হাতে পুরনো নোটিশ ধরেই আসেন।`,
    'published',
    'S. Nahar',
    '2026-10-16',
    '2026-10-16 08:30',
    9,
  ),
  page(
    'news/dengue-season',
    'news',
    'Dengue season: what to watch for',
    'ডেঙ্গু মৌসুম: কোন লক্ষণগুলি খেয়াল রাখবেন',
    `## The fever that needs a blood test
Dengue starts like any other fever: temperature, headache, pain behind the eyes and in the joints. What matters is the day after the fever breaks, when the platelet count can fall.
! Come to the emergency department if the fever is with bleeding from the gums or nose, severe abdominal pain, vomiting that will not stop, cold hands, or the patient is drowsy or confused — whoever they are, whatever time it is.
## What we do
We check the blood count daily while the fever lasts. Not everybody who has dengue is admitted: most patients are followed in the outdoor clinic with a daily count. Admission is for the ones whose count is falling fast, who cannot drink, or who have no adult at home to watch them.
Text message reminders: the hospital sends the daily count reminder by SMS if you agree — ask at the desk, or agree in the patient portal.`,
    `## যে জ্বরে রক্ত পরীক্ষা দরকার
ডেঙ্গু সাধারণ জ্বরের মতোই শুরু হয়: জ্বর, মাথাব্যথা, চোখের পিছনে ও গিরায় ব্যথা। আসল কথা হলো জ্বর নামার পরের দিনটি, যখন প্লেটলেট কমে যেতে পারে।
! মুখ বা নাক দিয়ে রক্ত পড়লে, তীব্র পেটব্যথা হলে, থামছেই না এমন বমি হলে, হাত ঠান্ডা হয়ে গেলে, অথবা রোগীর ঘুমঘুম ভাব বা অসংলগ্ন কথা হলে — যেই হন, যে সময়ই হোক, জরুরি বিভাগে আসুন।
## আমরা কী করি
জ্বর থাকা পর্যন্ত প্রতিদিন রক্তের গণনা দেখানো হয়। ডেঙ্গু হলেই সবাইকে ভর্তি করা হয় না: বেশির ভাগ রোগীকে বহির্বিভাগে প্রতিদিনের গণনা দিয়ে চলে। ভর্তি করা হয় তাঁদের, যাঁদের গণনা দ্রুত পড়ছে, যাঁরা খেতে পারছেন না, অথবা যাঁদের বাড়িতে নজর রাখার মতো কোনো বড় মানুষ নেই।
এসএমএস মনে করানো: রাজি থাকলে হাসপাতাল প্রতিদিনের গণনার এটি এসএমএস-এ পাঠায় — ডেস্কে বলুন, বা রোগী পোর্টালে রাজি হন।`,
    'published',
    'Dr. S. Rahman',
    '2026-08-20',
    '2026-08-20 09:00',
    3,
  ),
  page(
    'careers',
    'careers',
    'Work with us',
    'আমাদের সঙ্গে কাজ করুন',
    `## Vacancies
This list is written from the recruitment register, and a post that has been filled is taken off it the same day. Applying for a post that closed last week wastes everybody's time, including the applicant's.
- Staff nurse — night shift, Main Campus, four posts. BSc or diploma with a current registration; night allowance and overtime as per policy
- Medical technologist — laboratory, Main Campus, one post. Two years in a hospital laboratory
- Aya — ward support, Mirpur branch, two posts
## How to apply
Bring a written application, a photograph and copies of your certificates to the front desk, or send them to the HR office. The desk will give you a receipt with the date on it. Nobody at the hospital will ask you for money at any stage of recruitment.`,
    `## শূন্যপদ
এই তালিকা নিয়োগ রেজিস্টার থেকে লেখা হয়, আর পদ পূরণ হলে সেদিনই তালিকা থেকে বাদ পড়ে। গত সপ্তাহে বন্ধ হওয়া পদের জন্য আবেদন করলে সবার সময় নষ্ট হয়, আবেদনকারীরও।
- স্টাফ নার্স — নাইট শিফট, প্রধান ক্যাম্পাস, চারটি পদ। বিএসসি বা ডিপ্লোমা, নিবন্ধন চালু থাকতে হবে; নাইট ভাতা ও ওভারটাইম নীতিমালা অনুযায়ী
- মেডিকেল টেকনোলজিস্ট — ল্যাব, প্রধান ক্যাম্পাস, একটি পদ। হাসপাতালের ল্যাবে দুই বছরের অভিজ্ঞতা
- আয়া — ওয়ার্ড সহায়িকা, মিরপুর শাখা, দুটি পদ
## আবেদনের নিয়ম
লিখিত আবেদন, ছবি ও সনদপত্রের কপি নিয়ে ফ্রন্ট ডেস্কে আসুন, অথবা এইচআর অফিসে পাঠান। ডেস্ক তারিখ লেখা একটি রসিদ দেবে। নিয়োগের কোনো ধাপেই হাসপাতাল আপনার কাছে টাকা চাইবে না।`,
    'published',
    'J. Alam',
    '2026-10-08',
    '2026-10-08 12:00',
    4,
  ),
  page(
    'contact',
    'contact',
    'How to reach us',
    'আমাদের সাথে যোগাযোগ',
    `## Telephone
Desk: 02 9876 540, 08:00–20:00. Emergency: 02 9876 500, 24 hours. Ambulance: 02 9876 555, 24 hours. Billing desk: 02 9876 560, 09:00–18:00.
## Addresses
Main Campus: 22 Green Road, Dhaka 1205 — the entrance is on Green Road, and the ambulance gate is on the side road for anything that must not wait in traffic.
Uttara Branch: House 14, Road 7, Sector 4, Uttara, Dhaka 1230.
Mirpur Branch: Plot 9, Mirpur 10 roundabout, Dhaka 1216.
## Getting here
Buses stop at the Farmgate and Green Road crossings, both within a five-minute walk. The hospital car park holds 40 cars and is free for patients and visitors, on a first-come basis; in the morning it is usually full by 09:30, and the guard will tell you where to leave a car rather than leave you circling.`,
    `## টেলিফোন
ডেস্ক: ০২ ৯৮৭৬ ৫৪০, সকাল ৮টা–রাত ৮টা। জরুরি: ০২ ৯৮৭৬ ৫০০, চব্বিশ ঘণ্টা। অ্যাম্বুলেন্স: ০২ ৯৮৭৬ ৫৫৫, চব্বিশ ঘণ্টা। বিলিং ডেস্ক: ০২ ৯৮৭৬ ৫৬০, সকাল ৯টা–সন্ধ্যা ৬টা।
## ঠিকানা
প্রধান ক্যাম্পাস: ২২ গ্রিন রোড, ঢাকা ১২০৫ — মূল ফটক গ্রিন রোডে, আর অ্যাম্বুলেন্সের গেট পাশের রাস্তায়, যাতে যেটা অপেক্ষা করতে পারে না, সেটা যানজটে না পড়ে।
উত্তরা শাখা: বাড়ি ১৪, রোড ৭, সেক্টর ৪, উত্তরা, ঢাকা ১২৩০।
মিরপুর শাখা: প্লট ৯, মিরপুর ১০ গোলচত্বর, ঢাকা ১২১৬।
## আসার পথ
ফার্মগেট ও গ্রিন রোড ক্রসিংয়ে বাস থামে, দুটোই পাঁচ মিনিটের হাঁটা। হাসপাতালের পার্কিংয়ে ৪০টি গাড়ি ধরে, রোগী ও দর্শনার্থীর জন্য বিনামূল্যে, আগে এলে আগে পাবেন; সকালে সাধারণত সাড়ে নয়টার মধ্যে ভরে যায়, আর গার্ড আপনাকে গাড়ি রাখার জায়গা বলে দেবেন — শুধু চক্কর খাওয়াবেন না।`,
    'published',
    'S. Nahar',
    '2026-10-03',
    '2026-10-03 14:10',
    3,
  ),
  page(
    'about/annual-report-2025',
    'about',
    'Annual report 2025',
    'বার্ষিক প্রতিবেদন ২০২৫',
    `## The year in numbers
2025 treated 41 512 outdoor patients and 6 208 inpatients. The laboratory ran 118 940 tests. The average outdoor waiting time was 47 minutes, which is 9 minutes longer than 2024, and the reason was the two months when the outdoor registration counter was short of staff.
## The things we said we would fix
- The outdoor waiting time: a second registration counter now opens at 08:00 rather than 09:00
- Discharge summaries handed over within 24 hours: now 92% against 78%
- The telephone tree for the emergency department, which was tested twice`,
    `## বছরের হিসাব
২০২৫ সালে ৪১ ৫১২ জন বহির্বিভাগের রোগী এবং ৬ ২০৮ জন অন্তঃবিভাগের রোগী চিকিৎসা নিয়েছেন। ল্যাবে হয়েছে ১ ১৮ ৯৪০টি পরীক্ষা। বহির্বিভাগে গড় অপেক্ষার সময় ছিল ৪৭ মিনিট, যা ২০২৪ সালের চেয়ে ৯ মিনিট বেশি — কারণ দুই মাস বহির্বিভাগের নিবন্ধন কাউন্টারে লোক কম ছিল।
## যেগুলো ঠিক করার কথা বলেছিলাম
- বহির্বিভাগের অপেক্ষার সময়: সকাল ৯টার বদলে ৮টায় দ্বিতীয় নিবন্ধন কাউন্টার খোলে
- ছাড়পত্র ২৪ ঘণ্টার মধ্যে হাতে হাতে দেওয়া: এখন ৯২%, আগে ৭৮%
- জরুরি বিভাগের টেলিফোন-তালিকা, যা দুইবার পরীক্ষা করা হয়েছিল`,
    'published',
    'R. Howlader',
    '2026-02-14',
    '2026-02-14 10:00',
    5,
  ),
  /* A draft: written, not published, and the site must not show it to anybody. */
  page(
    'news/blood-donation-camp',
    'news',
    'Blood donation camp, 2 October',
    'রক্তদান শিবির, ২ অক্টোবর',
    `## In the hospital car park
09:00 to 14:00, with the Sandhani volunteers. No appointment needed. Bring a photograph or an identity card, and eat something before you come.
! Please do not come if you have had a fever in the last seven days, or if you take a medicine the volunteers ask about. The volunteers will say no, and it is not a judgement — the blood goes to somebody who cannot afford a mistake.`,
    `## হাসপাতালের পার্কিংয়ে
সকাল ৯টা থেকে দুপুর ২টা, সন্ধানী স্বেচ্ছাসেবকদের সঙ্গে। আগাম সময় নেওয়ার দরকার নেই। ছবি বা পরিচয়পত্র আনুন, এবং আসার আগে কিছু খেয়ে আসুন।
! গত সাত দিনে জ্বর থাকলে, বা স্বেচ্ছাসেবকেরা যে ওষুধ নিয়ে জিজ্ঞেস করে সেটি খেলে আসবেন না। স্বেচ্ছাসেবকেরা "না" বলবেন, আর সেটি কোনো বিচার নয় — রক্ত যাবে এমন কারও কাছে, যাঁর ভুলের সুযোগ নেই।`,
    'draft',
    'S. Nahar',
    '2026-09-16',
    undefined,
    1,
  ),
];

export const pageBySlug = (slug: string, pages: CmsPage[] = CMS_PAGES): CmsPage | undefined => pages.find((p) => p.slug === slug);
export const publishedPages = (pages: CmsPage[] = CMS_PAGES): CmsPage[] => pages.filter((p) => p.state === 'published');
export const pagesInSection = (section: SiteSection, pages: CmsPage[] = CMS_PAGES): CmsPage[] => pages.filter((p) => p.section === section);

/**
 * Everything the public site needs to draw itself: the menu, the pages, and the facts that are rendered from the
 * hospital's own registers rather than typed into a page.
 */
export interface SiteSnapshot {
  menu: Array<{ section: SiteSection; label: string; labelBn: string; href: string; pages: CmsPage[] }>;
  home: CmsPage;
  notices: string[];
  facts: Array<{ key: string; keyBn: string; value: string; valueBn: string }>;
  pageCount: number;
  lastPublished?: string;
}

/** The facts a hospital website is actually asked for, read from the branch register and the platform settings. */
export function siteFacts(): SiteSnapshot['facts'] {
  return [
    { key: 'Outdoor clinic', keyBn: 'বহির্বিভাগ', value: '08:00–20:00, Saturday to Thursday', valueBn: 'সকাল ৮টা–রাত ৮টা, শনি–বৃহস্পতি' },
    { key: 'Emergency', keyBn: 'জরুরি বিভাগ', value: 'Open 24 hours, every day', valueBn: 'চব্বিশ ঘণ্টা খোলা, প্রতি দিন' },
    { key: 'Desk telephone', keyBn: 'ডেস্কের টেলিফোন', value: '02 9876 540', valueBn: '০২ ৯৮৭৬ ৫৪০' },
    { key: 'Emergency telephone', keyBn: 'জরুরি টেলিফোন', value: '02 9876 500', valueBn: '০২ ৯৮৭৬ ৫০০' },
    { key: 'Ambulance', keyBn: 'অ্যাম্বুলেন্স', value: '02 9876 555', valueBn: '০২ ৯৮৭৬ ৫৫৫' },
    { key: 'Address', keyBn: 'ঠিকানা', value: '22 Green Road, Dhaka 1205', valueBn: '২২ গ্রিন রোড, ঢাকা ১২০৫' },
  ];
}

export function siteSnapshot(pages: CmsPage[] = CMS_PAGES): SiteSnapshot {
  const published = publishedPages(pages);
  const noticePage = published.find((p) => p.section === 'notice');
  const notices = noticePage ? parseBody(noticePage.bodyEn, 'en').filter((b) => b.kind === 'notice').map((b) => b.en) : [];
  const home = published.find((p) => p.section === 'home') ?? published[0];
  const menu = SECTIONS.filter((s) => s.section !== 'home').map((s) => ({
    section: s.section,
    label: s.label,
    labelBn: s.labelBn,
    href: s.slug === '' ? '/site' : `/site/${s.slug}`,
    pages: published.filter((p) => p.section === s.section),
  }));
  return {
    menu,
    home,
    notices,
    facts: siteFacts(),
    pageCount: published.length,
    lastPublished: published.map((p) => p.publishedAt ?? p.updatedAt).sort().at(-1),
  };
}

/* ------------------------------------------------------------------------------ the checks */

export interface CmsIssue {
  code: string;
  message: string;
}

export interface CmsCheck {
  ok: boolean;
  reasons: CmsIssue[];
  warnings: CmsIssue[];
}

export interface CmsContext {
  today: string;
  pages: CmsPage[];
  /**
   * The slug this page is filed under in the register, or `null` when it is a new page.
   *
   * Without it the check cannot tell “I am editing the page at /about” from “I am creating a second page at
   * /about”, and a second page at the same address is exactly the mistake the rule is there for. Omitted, the page
   * is assumed to be in the register under the slug it currently carries.
   */
  editing?: string | null;
}

/** The events a page may be audited against; kept short, because a page is not a form. */
export interface CmsEvent {
  at: string;
  what: 'created' | 'edited' | 'published' | 'unpublished' | 'retired';
  by: string;
  note?: string;
}

export const PAGE_EVENTS: CmsEvent[] = [
  { at: '2026-10-12 09:20', what: 'published', by: 'R. Howlader', note: 'Published revision 7. The emergency block was moved above the outpatient hours: two people had telephoned about the wrong thing in a week.' },
  { at: '2026-10-11 17:40', what: 'edited', by: 'M. Hoque', note: 'The Uttara address corrected — the sector in the old text was wrong.' },
  { at: '2026-09-30 11:05', what: 'unpublished', by: 'R. Howlader', note: 'Taken down for two hours while the telephone number on the contact page was being checked.' },
  { at: '2026-09-16 09:12', what: 'created', by: 'S. Nahar', note: 'Blood donation camp page drafted. Not published: the camp date is confirmed by the volunteers a week in advance.' },
];

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

/**
 * The rules a page has to pass before it can be published.
 *
 * They are checked in the editor while the page is being written, not after somebody presses publish, because the
 * only useful moment to be told that the Bangla title is missing is while the person who wrote it is still there.
 */
export function checkPage(draft: CmsPage, ctx: CmsContext): CmsCheck {
  const reasons: CmsIssue[] = [];
  const warnings: CmsIssue[] = [];
  const spec = sectionFor(draft.section);
  // Every page except the one being edited. A new page excludes nothing, which is what makes a collision visible.
  const pages = ctx.editing === null ? ctx.pages : ctx.pages.filter((p) => p.slug !== (ctx.editing ?? draft.slug));

  if (!draft.titleEn.trim() || !draft.titleBn.trim()) {
    reasons.push({
      code: 'title-missing',
      message: `A page needs a title in both languages. ${draft.titleEn.trim() ? 'The Bangla title is missing' : draft.titleBn.trim() ? 'The English title is missing' : 'Both are empty'}, and this page is filed under “${spec.label}”.`,
    });
  }
  if (draft.slug !== '' && !SLUG_RE.test(draft.slug)) {
    reasons.push({
      code: 'slug-invalid',
      message: `“${draft.slug}” is not a usable address. Lower-case words with dashes, and slashes for a section: “news/dengue-season”. Anything else ends up as “%20” in a shared link, and a hospital link that arrives broken is a patient who telephones instead.`,
    });
  }
  if (draft.slug !== '' && pages.some((p) => p.slug === draft.slug)) {
    reasons.push({ code: 'slug-taken', message: `Another page already uses /${draft.slug}. Two pages cannot answer the same address: pick a different one, or edit the page that is already there.` });
  }
  if (draft.section !== 'home' && draft.slug !== '' && !draft.slug.startsWith(spec.slug)) {
    reasons.push({
      code: 'slug-section-mismatch',
      message: `A page filed under “${spec.label}” should sit under /${spec.slug}/… — this one is at /${draft.slug}, so the menu cannot find it and neither can a person typing the address.`,
    });
  }
  if (draft.section === 'home' && draft.slug !== '') {
    reasons.push({ code: 'home-slug', message: 'The front page has no address of its own: it is what a visitor gets at the hospital’s name. Keep the path empty.' });
  }
  if (!draft.bodyBn.trim()) {
    reasons.push({
      code: 'bangla-missing',
      message: `There is no Bangla text on this page. The site is Bangla-first: somebody looking for the outdoor clinic times in Dhaka reads Bangla, and an English-only page is half a page. ${spec.audience === 'patients' ? 'This section is written for patients.' : ''}`,
    });
  }
  if (!draft.bodyEn.trim()) {
    reasons.push({ code: 'english-missing', message: 'There is no English text. The switch to English is there for people who need it, and a page that falls back to the other language is a page with a broken switch.' });
  }
  const blocksBn = parseBody(draft.bodyBn, 'bn');
  const blocksEn = parseBody(draft.bodyEn, 'en');
  if (blocksBn.length === 0) reasons.push({ code: 'body-empty', message: 'The page has no content yet.' });
  if (draft.section === 'notice') {
    const undated = blocksEn.filter((b) => b.kind === 'notice' && !/\d{4}-\d{2}-\d{2}/.test(b.en));
    if (undated.length) {
      reasons.push({
        code: 'notice-undated',
        message: 'A notice block has no date in it. A notice without a date is read as current a year later, which is how a hospital keeps advertising a clinic it closed.',
      });
    }
    if (blocksEn.filter((b) => b.kind === 'notice').length === 0) {
      reasons.push({ code: 'no-notice-block', message: 'The notices page has no notice block. Write each notice on its own line beginning with “> ” and the date first.' });
    }
  }
  const factKeysEn = blocksEn.flatMap((b) => (b.rows ?? []).map((r) => r.en.split(':')[0]?.trim() ?? ''));
  const duplicate = factKeysEn.find((key, index) => key && factKeysEn.indexOf(key) !== index);
  if (duplicate) {
    warnings.push({ code: 'fact-repeated', message: `“${duplicate}” appears as a facts row more than once on this page. Two answers to the same question is worse than one, whichever it is.` });
  }
  const banglaDigitsInEnglish = /[\u0980-\u09FF]/.test(draft.bodyEn ?? '');
  if (banglaDigitsInEnglish) {
    warnings.push({ code: 'bangla-in-english', message: 'There is Bangla text inside the English version. The two versions are read by different people; the parser keeps them apart, and a stray line is usually a paste that went to the wrong box.' });
  }
  if (/lorem ipsum|TODO|FIXME|xxx/i.test(`${draft.bodyEn} ${draft.bodyBn}`)) {
    reasons.push({ code: 'placeholder', message: 'The page still has placeholder text in it. That is how a page about a service the hospital does not offer ends up on the public site for two years.' });
  }
  if (draft.state === 'published' && !draft.author.trim()) {
    reasons.push({ code: 'no-author', message: 'A published page carries the name of the person who wrote the version that is live. On a hospital site that name is the answer to “who do I ask about this?”' });
  }
  if (draft.state === 'published' && draft.section === 'home' && draft.revision < 2) {
    warnings.push({ code: 'first-revision', message: 'This is the first revision of the front page. Publishing replaces what the public sees immediately — read it once on a telephone before you do.' });
  }
  const stale = draft.state === 'published' && draft.updatedAt && draft.updatedAt < shiftMonths(ctx.today, -12);
  if (stale) {
    warnings.push({
      code: 'stale',
      message: `Last edited ${draft.updatedAt}. A page nobody has looked at in a year is usually the one with an old telephone number or an old price on it — and this is the page strangers arrive on.`,
    });
  }
  if (draft.state === 'retired' && draft.section === 'home') {
    reasons.push({ code: 'home-retired', message: 'The front page cannot be retired: it is what the hospital’s name resolves to. Write a short page instead, even if it says only the address and the emergency number.' });
  }
  if (draft.state === 'draft' && draft.section === 'notice' && blocksEn.some((b) => b.kind === 'notice')) {
    warnings.push({ code: 'unpublished-notice', message: 'A notice written and not published. Notices are usually urgent to somebody; if it is not ready, say what is still missing rather than leaving it to be asked about.' });
  }
  return { ok: reasons.length === 0, reasons, warnings };
}

function shiftMonths(dayIso: string, delta: number): string {
  const d = new Date(`${dayIso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 10);
}

/** What publication means, in the order it happens. Shown on the screen rather than implied. */
export const PUBLISH_RULES: string[] = [
  'Publication is one act in one place: the contract marks it online-only, because the public site is served from the cloud. A publication that exists only on this node is a page the public cannot reach while the editor believes it is live.',
  'The site is served from a cache. A published page is visible to everybody within a couple of minutes and to nobody before the cache turns over, so a page corrected one minute after publication is still the old page for a few more.',
  'The page keeps its revisions. Unpublishing does not delete it: the revision that was live stays, with the time it was live.',
  'The Bangla and English versions publish together, or neither does. A half-published page is a broken switch.',
  'Nothing is removed from the site by editing it into emptiness: a page that should no longer exist is retired, and the address answers with a short explanation and a way to the right page rather than a blank.',
];

export interface CmsStats {
  pages: number;
  published: number;
  drafts: number;
  retired: number;
  missingBangla: number;
  stale: number;
  words: number;
  lastEdit: string;
  editors: number;
}

export function cmsStats(pages: CmsPage[] = CMS_PAGES, today = '2026-10-16'): CmsStats {
  const words = pages.reduce((n, p) => n + `${p.bodyEn} ${p.bodyBn}`.split(/\s+/).filter(Boolean).length, 0);
  return {
    pages: pages.length,
    published: pages.filter((p) => p.state === 'published').length,
    drafts: pages.filter((p) => p.state === 'draft').length,
    retired: pages.filter((p) => p.state === 'retired').length,
    missingBangla: pages.filter((p) => !p.bodyBn.trim()).length,
    stale: pages.filter((p) => p.state === 'published' && p.updatedAt < shiftMonths(today, -12)).length,
    words,
    lastEdit: pages.map((p) => p.updatedAt).sort().at(-1) ?? today,
    editors: new Set(pages.map((p) => p.author)).size,
  };
}

/** The departments the site lists, read from the register rather than retyped. */
export const SITE_DEPARTMENTS: Array<{ name: string; nameBn: string; outdoor: string; outdoorBn: string; where: string }> = [
  { name: 'Medicine and diabetes', nameBn: 'মেডিসিন ও ডায়াবেটিস', outdoor: 'Sunday, Tuesday and Thursday, from 09:00', outdoorBn: 'রবি, মঙ্গল ও বৃহস্পতি, সকাল ৯টা থেকে', where: 'OPD-1' },
  { name: 'Surgery and orthopaedics', nameBn: 'সার্জারি ও অর্থোপেডিক', outdoor: 'Saturday to Wednesday, from 09:00', outdoorBn: 'শনি থেকে বুধ, সকাল ৯টা থেকে', where: 'OPD-2' },
  { name: 'Obstetrics and antenatal care', nameBn: 'প্রসূতি ও এএনসি', outdoor: 'Every day from 08:30, including holidays', outdoorBn: 'প্রতি দিন সকাল ৮:৩০ থেকে, ছুটির দিনও', where: 'OPD-4' },
  { name: 'Child health and vaccination', nameBn: 'শিশু স্বাস্থ্য ও টিকাদান', outdoor: 'Saturday to Wednesday, from 09:30', outdoorBn: 'শনি থেকে বুধ, সকাল ৯:৩০ থেকে', where: 'OPD-3' },
  { name: 'Laboratory and imaging', nameBn: 'ল্যাব ও ইমেজিং', outdoor: 'Sample collection 07:00–21:00, every day', outdoorBn: 'নমুনা সংগ্রহ সকাল ৭টা–রাত ৯টা, প্রতি দিন', where: 'Ground floor' },
  { name: 'Emergency and accident', nameBn: 'জরুরি ও দুর্ঘটনা', outdoor: '24 hours, every day of the year', outdoorBn: 'চব্বিশ ঘণ্টা, বছরের প্রতিটি দিন', where: 'Main gate' },
];

export const CMS_WAITING: string[] = [
  'There is no image upload in this build: the pages carry text and the hospital’s own facts, and photographs are attached to the Download Centre where a patient-facing file is approved before it is shared. A hospital website with a photograph of an identifiable patient in a ward, uploaded without a consent record, is the mistake this rule exists to prevent.',
  'The site is rendered by this application as a preview — the same records, the same blocks. A production deployment serves the identical blocks as static pages behind a cache, and the menu, the sitemap and the redirect list come from the same tables.',
  'Search on the site is a later piece of work. Until it exists the menu and the page list are the navigation, and the pages are written to be findable from them.',
  'The Bangla font is not subsetted in this build, so the first Bangla page load is heavier than it should be on a slow connection. It is a fixed cost to anyone who reads Bangla, and it has to be paid once per visitor.',
];
