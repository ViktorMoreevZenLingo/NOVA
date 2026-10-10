import { getLanguage } from "./i18n.js";
import { historyOverview } from "./history.js";
const l = (bg, en) => (getLanguage() === "bg" ? bg : en);
export function homeView(state, services, icon, serviceIcon) {
  const usage = historyOverview(icon);
  const recommendationOrder = ["contacts", "gmail", "calendar", "outlook", "places"];
  const recommendations = recommendationOrder
    .map(id => services.find(service => service.id === id))
    .filter(service => service && !state.connected.has(service.id))
    .slice(0, 2);
  const benefits = {
    places: l("Намирай места, адреси и работно време.", "Find places, addresses, and opening hours."),
    outlook: l("Пощата, срещите и контактите ти в Outlook.", "Your Outlook email, meetings, and contacts."),
    calendar: l(
      "Срещите ти, подредени с едно обаждане.",
      "Manage your schedule with a phone call.",
    ),
    contacts: l("Намирай хората си по име.", "Find your contacts by name."),
    gmail: l(
      "Преглеждай писма и подготвяй отговори.",
      "Catch up on email and prepare replies.",
    ),
  };
  return `<section class="home-overview"><p class="home-description">${l("Тук виждаш какво е свършил Ало и какво предстои. Свържи услугите си, за да му дадеш повече възможности да ти помага.", "See what Alo has done and what’s still in progress. Connect your services to give Alo more ways to help you.")}</p>
 <section aria-labelledby="recent-title"><div class="home-section-title"><h2 id="recent-title">${l("Последна активност", "Recent activity")}</h2><button class="text-button" data-action="history">${l("Виж всички", "View all")}${icon("chevron")}</button></div><div class="history-list">${usage.activity}</div></section>
 <section aria-labelledby="recommended-title"><div class="home-section-title"><h2 id="recommended-title">${l("Свържи с Ало", "Connect to Alo")}</h2><button class="text-button" data-action="integrations">${l("Интеграции", "Integrations")}${icon("chevron")}</button></div>${recommendations.length ? `<div class="recommendations">${recommendations.map((s) => `<button class="recommendation" data-service="${s.id}"><span class="recommendation-icon">${serviceIcon(s.id)}</span><span><strong>${s.name}</strong><span>${benefits[s.id]}</span></span><span class="recommendation-action">${l("Свържи", "Connect")}${icon("chevron")}</span></button>`).join("")}</div>` : `<div class="connections-complete">${icon("check")}<span>${l("Всички услуги са свързани.", "All services are connected.")}</span></div>`}</section></section>`;
}
