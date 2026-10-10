const translations = {
  "Търсене на места и услуги": "Find places and local services",
  "Преглед на адреси, телефони и работно време": "View addresses, phone numbers, and opening hours",
  "Преглед на имейли и подготовка на чернови": "Read emails and prepare drafts",
  "Преглед и създаване на срещи": "View and create calendar events",
  "Добави контекст за себе си, за да може Ало да се съобразява с предпочитанията ти. Свържи контактите, пощата и календара си, за да ти помага с хората, писмата и срещите ти по телефона.": "Add context about yourself so Alo can take your preferences into account. Connect your contacts, email, and calendar to get help with the people, messages, and meetings in your day—all over the phone.",
  "Интеграции": "Integrations",
  "Премахни снимката": "Remove photo",
  Профил: "Profile",
  "Изтрий профила": "Delete account",
  Отказ: "Cancel",
  "Това премахва профила и контекста ти от този браузър. За потвърждение въведи номера си:":
    "This removes your profile and context from this browser. To confirm, enter your phone number:",
  "Профилът не беше изтрит. Опитай отново.":
    "Your account could not be deleted. Please try again.",
  "Профилът е изтрит.": "Account deleted.",
  Ало: "Alo",
  ало: "alo",
  Начало: "Home",
  История: "History",
  Опции: "Options",
  "Свързани услуги": "Connected services",
  от: "of",
  Вход: "Sign In",
  Регистрация: "Sign Up",
  "Вход или регистрация": "Sign in or sign up",
  "Вход в Ало": "Sign in to Alo",
  "Създай профил": "Create an account",
  "Потвърди номера": "Confirm your number",
  "Въведи шестцифрения код за потвърждение на":
    "Enter the six-digit verification code for",
  "Код за потвърждение": "Verification code",
  "Шестцифрен код за потвърждение": "Six-digit verification code",
  "Мобилен номер": "Mobile number",
  Влез: "Sign In",
  Продължи: "Continue",
  Назад: "Back",
  "Попълни 123456": "Fill in 123456",
  Свържи: "Connect",
  Редактирай: "Edit",
  "Редактирай профила": "Edit Profile",
  Свързано: "Connected",
  "Не е свързано": "Not Connected",
  "Прекъсни връзката": "Disconnect",
  "Преглед на срещите": "View calendar events",
  "Създаване на събития след потвърждение": "Create events after confirmation",
  "Търсене на контакти": "Find contacts",
  "Преглед на телефонни номера и имейли":
    "View phone numbers and email addresses",
  "Преглед на имейли": "Read emails",
  "Подготовка на чернови": "Prepare drafts",
  "Твоят профил": "Your profile",
  "Информация за теб": "Profile Context",
  "За теб": "Profile Context",
  "Можеш да промениш всичко по-късно.": "You can change these details anytime.",
  Име: "Name",
  Град: "City",
  Занимание: "Occupation",
  "Какво да знае Ало за теб": "What should Alo know about you",
  "по желание": "optional",
  "Предпочитания, навици или нещо важно за теб":
    "Preferences, routines or anything important to you",
  "Добави снимка": "Add photo",
  "Смени снимката": "Change photo",
  Премахни: "Remove",
  Запази: "Save",
  Изход: "Sign Out",
  Затвори: "Close",
  Преглед: "Preview",
  "Контроли за преглед": "Preview controls",
  Код: "Code",
  "Всички свързани": "All connected",
  "Всички несвързани": "All disconnected",
  "Показани са всички свързани услуги.": "Showing all services connected.",
  "Показани са всички несвързани услуги.": "Showing all services disconnected.",
  "Основна навигация": "Main navigation",
  Език: "Language",
  "Жена, която разговаря по телефона, седнала на стълби":
    "A woman sitting on steps talking on the phone",
  "Въведи валиден мобилен номер, например 0888 123 456.":
    "Enter a valid Bulgarian mobile number, e.g. 0888 123 456.",
  "Използвай код 123456.": "Use code 123456.",
  "Въведи името си.": "Enter your name.",
  "Избери JPG, PNG или WebP снимка до 2 MB.":
    "Choose a JPG, PNG or WebP image up to 2 MB.",
  "Снимката не може да бъде отворена. Избери друга.":
    "This image could not be opened. Choose another.",
  "Изчакай снимката да се зареди.": "Wait for the photo to finish loading.",
  "Профилът е запазен.": "Profile saved.",
  "Промените са запазени за тази сесия.": "Changes saved for this session.",
};
let language = "bg";
try {
  if (localStorage.getItem("alo:language") === "en") language = "en";
} catch {}
export const getLanguage = () => language;
export function setLanguage(value) {
  language = value === "en" ? "en" : "bg";
  try {
    localStorage.setItem("alo:language", language);
  } catch {}
}
export const t = (key) =>
  language === "en" ? (translations[key] ?? key) : key;
export function translateMessage(message) {
  const key = Object.keys(translations).find(
    (key) => key === message || translations[key] === message,
  );
  return key ? t(key) : message;
}
