/**
 * The console's two languages (PRG-014): English, and Arabic written right to left.
 *
 * The Arabic carries over the warehouse system's own wording where it had a string for
 * the same thing (src/contexts/LanguageContext.tsx there), so the people moving across
 * read the words they already know: الرقم الوظيفي، الرمز السري، الأصناف، إنشاء صنف.
 * Everything new is marked in the UAT pack for a native speaker's review before staff
 * use it, as every UAT pack here is (docs/lab/uat/).
 *
 * The two tables have the same keys by construction: AR is typed against EN, so a key
 * missing from either fails `npm run typecheck`, and test/logic.test.ts checks that no
 * value is empty and every menu label is here.
 *
 * Requirements: PRG-014
 */

export type Lang = 'en' | 'ar';

const EN = {
  app_title: 'First Taste ERP',
  company_name: 'First Taste Trading Company',

  // sign-in (warehouse wording)
  signin_welcome: 'Welcome back',
  signin_hint: 'Sign in with your employee number and PIN.',
  employee_number: 'Employee number',
  pin: 'PIN',
  sign_in: 'Sign in',
  signing_in: 'Signing in…',
  signin_wrong_pin: 'Wrong employee number or PIN.',
  signin_attempts_left: 'Attempts left before the account locks: {n}.',
  signin_locked: 'Too many wrong attempts. Try again after {time}.',
  signin_account_disabled: 'This account is disabled. Ask your manager.',
  signin_malformed: 'Enter your employee number and PIN.',
  sign_out: 'Sign out',
  session_ended: 'Your session has ended. Sign in again.',
  session_idle: 'You were signed out after 30 minutes without activity.',

  // shell
  language: 'العربية',
  facility: 'Where you are working',
  org_wide: 'Whole organisation',
  preview_read_only: 'Preview — read only',
  nothing_enabled: 'No capability is enabled for you here yet.',
  not_built_yet: 'This screen has not been built yet. It arrives with its module.',
  loading: 'Loading…',
  network_error: 'The server could not be reached. Check the connection and try again.',
  unexpected_error: 'Something went wrong on the server. Nothing was changed by this screen.',
  back: 'Back',
  reload: 'Reload',
  cancel: 'Cancel',
  save: 'Save',
  saving: 'Saving…',
  more: 'Load more',
  yes: 'Yes',
  no: 'No',

  // menu
  nav_setup: 'Setup',
  nav_inventory: 'Inventory',
  nav_factory: 'Factory',
  nav_finance: 'Finance',
  capabilities: 'Capabilities',
  users: 'Users',
  items: 'Items',
  current_stock: 'Current stock',
  production: 'Production',
  month_end: 'Month end',
  payroll: 'Payroll',

  // items
  create_item: 'Create item',
  edit_item: 'Edit item',
  item_code: 'Item code',
  item_kind: 'Kind',
  base_unit: 'Storage unit',
  brand: 'Brand',
  name_en: 'Name (English)',
  name_ar: 'Name (Arabic)',
  description_en: 'Description (English)',
  description_ar: 'Description (Arabic)',
  descriptions_hint: 'Both languages, or neither.',
  status: 'Status',
  status_active: 'Active',
  status_retired: 'Retired',
  status_all: 'All',
  search: 'Search code or name',
  all_kinds: 'All kinds',
  all_brands: 'All brands',
  no_items: 'No items match.',
  reason: 'Reason for this change',
  reason_hint: 'Recorded with the change, for whoever reads the history.',
  retire_item: 'Retire item',
  reinstate_item: 'Reinstate item',
  fixed_fields: 'Code, kind, storage unit and brand are fixed once an item is created.',
  units: 'Units',
  unit: 'Unit',
  factor: 'How many storage units',
  factor_hint: 'Leave empty for a unit of the same kind as the storage unit; it is worked out.',
  add_unit: 'Add unit',
  add_unit_hint: 'A unit already active on this item is not offered. To change its size, retire it first, then add it again.',
  retire_unit: 'Retire',
  unit_retired: 'retired',
  history: 'History',
  decided_at: 'When',
  decision: 'Change',
  decided_by: 'By',
  kind_item_created: 'Created',
  kind_item_amended: 'Amended',
  kind_item_status_changed: 'Status changed',
  kind_unit_added: 'Unit added',
  kind_unit_retired: 'Unit retired',
  read_only_here: 'You can read items here but not change them.',
  saved: 'Saved.',
  already_recorded: 'This change was already saved. Showing the item as it is now.',

  // item kinds (INV-002; 0012's item_kind_is_known)
  kind_raw_ingredient: 'Raw ingredient',
  kind_semi_finished: 'Semi-finished',
  kind_finished_product: 'Finished product',
  kind_packaging: 'Packaging',
  kind_cleaning_supply: 'Cleaning supply',
  kind_operating_supply: 'Operating supply',
  kind_equipment: 'Equipment',
  kind_spare_part: 'Spare part',

  // import
  bulk_upload: 'Bulk upload',
  import_hint: 'A CSV file with a header row. Columns: {columns}. An existing code is updated; a new one is created. If any line fails, nothing is saved.',
  import_choose: 'Choose a CSV file',
  import_rows: 'Rows ready to upload: {n}.',
  import_submit: 'Upload',
  import_done: 'Done: {created} created, {amended} updated, {unchanged} unchanged.',
  import_failed_lines: 'Lines that failed:',
  import_after_doubt: 'An earlier attempt at this file got no answer and may have saved it. Rows it saved count as unchanged here, not created.',
  import_already: 'This file was already saved by an earlier attempt. Nothing was saved twice.',
  import_not_utf8: 'The file is not UTF-8. In Excel, save it as "CSV UTF-8".',
  import_empty: 'The file has no rows under its header.',
  import_too_many: 'The file has {rows} rows; one upload holds at most 5,000.',
  import_missing_column: 'The header has no "{column}" column.',
  import_unknown_column: 'The header has a column this upload does not know: "{column}".',
  import_duplicate_column: 'The header names "{column}" twice.',
  import_width: 'Line {line} has {found} values; the header has {expected}.',
  import_unknown_brand: 'Line {line}: there is no brand "{brand}" here.',
  import_quote: 'Line {line}: a quote is out of place. Put the whole value in quotes, or none of it.',
  in_doubt: 'The server did not answer, so this change may or may not have been saved. Retry sends exactly the same change and cannot record it twice. Start over checks what is saved first.',
  retry: 'Retry',
  start_over: 'Start over',

  // refusals (the edge's status words; refusal.ts)
  refusal_forbidden: 'You are not permitted to do this here.',
  refusal_conflict: 'That value is already in use.',
  refusal_stale: 'Someone changed this item after you opened it. Reload it and make your change again.',
  refusal_refused: 'This change breaks a rule of the item.',
  refusal_invalid: 'A value is not valid.',
  refusal_not_found: 'No such item here.',
  refusal_malformed: 'A field is missing or not valid: “{field}”.',
  refusal_too_large: 'The file is too large to upload in one go.',
  rule_code_taken: 'That item code is already in use.',
  rule_code_canonical: 'An item code is up to 24 letters A–Z, digits, ".", "_" or "-", starting with a letter or digit.',
  rule_descriptions_paired: 'Write the description in both languages, or leave both empty.',
  rule_reason_required: 'Give a reason for the change.',
  rule_factor_required: 'State how many storage units one of this unit holds.',
  rule_factor_inexact: 'That unit is not an exact number of storage units. Add the smaller unit first.',
  rule_unit_disagrees: 'That factor contradicts another unit of the same kind on this item.',
} as const;

export type Key = keyof typeof EN;

const AR: Readonly<Record<Key, string>> = {
  app_title: 'نظام الطعم الأول',
  company_name: 'شركة الطعم الأول للتجارة',

  signin_welcome: 'أهلاً بعودتك',
  signin_hint: 'سجّل الدخول برقمك الوظيفي ورمزك السري.',
  employee_number: 'الرقم الوظيفي',
  pin: 'الرمز السري',
  sign_in: 'تسجيل الدخول',
  signing_in: 'جارٍ تسجيل الدخول…',
  signin_wrong_pin: 'الرقم الوظيفي أو الرمز السري غير صحيح.',
  signin_attempts_left: 'المحاولات المتبقية قبل قفل الحساب: {n}.',
  signin_locked: 'محاولات خاطئة كثيرة. حاول مرة أخرى بعد {time}.',
  signin_account_disabled: 'هذا الحساب معطّل. راجع مديرك.',
  signin_malformed: 'أدخل رقمك الوظيفي ورمزك السري.',
  sign_out: 'تسجيل الخروج',
  session_ended: 'انتهت جلستك. سجّل الدخول مرة أخرى.',
  session_idle: 'تم تسجيل خروجك بعد ٣٠ دقيقة دون نشاط.',

  language: 'English',
  facility: 'مكان العمل',
  org_wide: 'المؤسسة كاملة',
  preview_read_only: 'معاينة — للقراءة فقط',
  nothing_enabled: 'لا توجد صلاحية مفعّلة لك هنا بعد.',
  not_built_yet: 'هذه الشاشة لم تُبنَ بعد، وستصل مع وحدتها.',
  loading: 'جاري التحميل...',
  network_error: 'تعذّر الوصول إلى الخادم. تحقّق من الاتصال وحاول مرة أخرى.',
  unexpected_error: 'حدث خطأ في الخادم. لم تُغيّر هذه الشاشة شيئاً.',
  back: 'رجوع',
  reload: 'إعادة التحميل',
  cancel: 'إلغاء',
  save: 'حفظ',
  saving: 'جارٍ الحفظ…',
  more: 'عرض المزيد',
  yes: 'نعم',
  no: 'لا',

  nav_setup: 'الإعداد',
  nav_inventory: 'المخزون',
  nav_factory: 'المصنع',
  nav_finance: 'المالية',
  capabilities: 'تفعيل الميزات',
  users: 'المستخدمون',
  items: 'الأصناف',
  current_stock: 'المخزون الحالي',
  production: 'الإنتاج',
  month_end: 'إقفال الشهر',
  payroll: 'الرواتب',

  create_item: 'إنشاء صنف',
  edit_item: 'تعديل الصنف',
  item_code: 'رمز الصنف',
  item_kind: 'النوع',
  base_unit: 'وحدة التخزين',
  brand: 'العلامة التجارية',
  name_en: 'الاسم (إنجليزي)',
  name_ar: 'الاسم (عربي)',
  description_en: 'الوصف (إنجليزي)',
  description_ar: 'الوصف (عربي)',
  descriptions_hint: 'باللغتين، أو لا شيء.',
  status: 'الحالة',
  status_active: 'نشط',
  status_retired: 'متوقف',
  status_all: 'الكل',
  search: 'ابحث بالرمز أو الاسم',
  all_kinds: 'كل الأنواع',
  all_brands: 'كل العلامات',
  no_items: 'لا توجد أصناف مطابقة.',
  reason: 'سبب هذا التغيير',
  reason_hint: 'يُحفظ مع التغيير لمن يقرأ السجل.',
  retire_item: 'إيقاف الصنف',
  reinstate_item: 'إعادة تفعيل الصنف',
  fixed_fields: 'الرمز والنوع ووحدة التخزين والعلامة ثابتة بعد إنشاء الصنف.',
  units: 'الوحدات',
  unit: 'الوحدة',
  factor: 'كم وحدة تخزين',
  factor_hint: 'اتركه فارغاً لوحدة من نفس نوع وحدة التخزين؛ يُحسب تلقائياً.',
  add_unit: 'إضافة وحدة',
  add_unit_hint: 'الوحدة النشطة في هذا الصنف لا تظهر هنا. لتغيير حجمها أوقفها أولاً ثم أضفها من جديد.',
  retire_unit: 'إيقاف',
  unit_retired: 'متوقفة',
  history: 'السجل',
  decided_at: 'متى',
  decision: 'التغيير',
  decided_by: 'بواسطة',
  kind_item_created: 'إنشاء',
  kind_item_amended: 'تعديل',
  kind_item_status_changed: 'تغيير الحالة',
  kind_unit_added: 'إضافة وحدة',
  kind_unit_retired: 'إيقاف وحدة',
  read_only_here: 'يمكنك قراءة الأصناف هنا دون تعديلها.',
  saved: 'تم الحفظ.',
  already_recorded: 'هذا التغيير محفوظ مسبقاً. يُعرض الصنف كما هو الآن.',

  kind_raw_ingredient: 'مادة خام',
  kind_semi_finished: 'نصف مصنّع',
  kind_finished_product: 'منتج نهائي',
  kind_packaging: 'مواد تغليف',
  kind_cleaning_supply: 'مواد تنظيف',
  kind_operating_supply: 'مستلزمات تشغيل',
  kind_equipment: 'معدات',
  kind_spare_part: 'قطع غيار',

  bulk_upload: 'رفع جماعي',
  import_hint: 'ملف CSV بصف عناوين. الأعمدة: {columns}. الرمز الموجود يُحدَّث والجديد يُنشأ. إذا فشل أي سطر لا يُحفظ شيء.',
  import_choose: 'اختر ملف CSV',
  import_rows: 'عدد الصفوف الجاهزة للرفع: {n}.',
  import_submit: 'رفع',
  import_done: 'تم: {created} جديد، {amended} محدَّث، {unchanged} دون تغيير.',
  import_failed_lines: 'الأسطر التي فشلت:',
  import_after_doubt: 'محاولة سابقة لهذا الملف لم تتلقَّ رداً وربما حفظته. الصفوف التي حفظتها تُحسب هنا دون تغيير، لا جديدة.',
  import_already: 'هذا الملف محفوظ مسبقاً بمحاولة سابقة. لم يُحفظ شيء مرتين.',
  import_not_utf8: 'الملف ليس بترميز UTF-8. في Excel احفظه بصيغة "CSV UTF-8".',
  import_empty: 'لا توجد صفوف تحت صف العناوين.',
  import_too_many: 'عدد صفوف الملف {rows}، والرفع الواحد يتسع لـ ٥٠٠٠ صف كحد أقصى.',
  import_missing_column: 'لا يوجد عمود "{column}" في صف العناوين.',
  import_unknown_column: 'في صف العناوين عمود غير معروف: "{column}".',
  import_duplicate_column: 'العمود "{column}" مذكور مرتين.',
  import_width: 'في السطر {line} عدد القيم {found}، بينما صف العناوين فيه {expected}.',
  import_unknown_brand: 'السطر {line}: لا توجد علامة "{brand}" هنا.',
  import_quote: 'السطر {line}: علامة اقتباس في غير مكانها. ضع القيمة كلها بين علامتي اقتباس أو لا تضعها.',
  in_doubt: 'لم يردّ الخادم، فقد يكون هذا التغيير حُفظ وقد لا يكون. «إعادة المحاولة» ترسل التغيير نفسه تماماً ولا يمكن أن تسجّله مرتين. «البدء من جديد» تتحقق أولاً مما حُفظ.',
  retry: 'إعادة المحاولة',
  start_over: 'البدء من جديد',

  refusal_forbidden: 'غير مسموح لك بهذا هنا.',
  refusal_conflict: 'هذه القيمة مستخدمة مسبقاً.',
  refusal_stale: 'غيّر شخص آخر هذا الصنف بعد أن فتحته. أعد تحميله ثم أعد التغيير.',
  refusal_refused: 'هذا التغيير يخالف قاعدة من قواعد الصنف.',
  refusal_invalid: 'إحدى القيم غير صحيحة.',
  refusal_not_found: 'لا يوجد صنف كهذا هنا.',
  refusal_malformed: 'حقل ناقص أو غير صحيح: «{field}».',
  refusal_too_large: 'الملف أكبر من أن يُرفع دفعة واحدة.',
  rule_code_taken: 'رمز الصنف هذا مستخدم مسبقاً.',
  rule_code_canonical: 'رمز الصنف حتى ٢٤ حرفاً من A–Z أو أرقام أو "." أو "_" أو "-"، ويبدأ بحرف أو رقم.',
  rule_descriptions_paired: 'اكتب الوصف باللغتين، أو اترك الاثنين فارغين.',
  rule_reason_required: 'اذكر سبب التغيير.',
  rule_factor_required: 'اذكر كم وحدة تخزين تحتوي هذه الوحدة.',
  rule_factor_inexact: 'هذه الوحدة لا تساوي عدداً صحيحاً من وحدات التخزين. أضف الوحدة الأصغر أولاً.',
  rule_unit_disagrees: 'هذا المعامل يخالف وحدة أخرى من النوع نفسه في هذا الصنف.',
};

export const STRINGS: Readonly<Record<Lang, Readonly<Record<Key, string>>>> = { en: EN, ar: AR };

/** The string for `key`, with `{name}` placeholders filled. An unknown placeholder stays visible. */
export function t(lang: Lang, key: Key, vars: Readonly<Record<string, string | number>> = {}): string {
  return STRINGS[lang][key].replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole);
}

/** A key built at run time — a menu label, an item kind — as a Key, or null when there is none. */
export function asKey(candidate: string): Key | null {
  return Object.prototype.hasOwnProperty.call(EN, candidate) ? (candidate as Key) : null;
}

/** The label for a run-time key, falling back to the key itself so nothing renders blank. */
export function label(lang: Lang, candidate: string): string {
  const key = asKey(candidate);
  return key === null ? candidate : t(lang, key);
}

export function dir(lang: Lang): 'rtl' | 'ltr' {
  return lang === 'ar' ? 'rtl' : 'ltr';
}

/** A bilingual record's name in the reader's language, falling back to the other. */
export function localName(lang: Lang, r: { readonly name_en?: string | null; readonly name_ar?: string | null }): string {
  const first = lang === 'ar' ? r.name_ar : r.name_en;
  const second = lang === 'ar' ? r.name_en : r.name_ar;
  return first ?? second ?? '';
}
