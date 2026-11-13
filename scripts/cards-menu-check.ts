// Headless checks for Alpha 1.9.8 — the CARDS section of the main menu (npm run cardsmenu): the catalog model (every card
// once, the right standing for a new career, a levelled one, after a purchase, for signatures of fighters in and out of
// the roster), buying through the career (once, the career price, never in the prep screen any more), the counts the
// menu shows, and backward compatibility — old saves and their bought cards, the cloud copy (no new save field).
// In-memory saves, no browser (the look and the real taps are checked in the browser — docs/ALPHA_1_9_8_WORKLOG.md).
import { cardPrice } from '../src/config/careerPrices';
import { CARDS, NEW_CARDS, UNIVERSAL_CARDS } from '../src/config/cards';
import { FIGHTERS, FIGHTER_ORDER } from '../src/config/fighters';
import type { CardId, FighterId } from '../src/config/types';
import { CareerSystem } from '../src/meta/CareerSystem';
import { defaultSave, sanitize, type SaveData, type SaveSystem } from '../src/meta/SaveSystem';
import { canonicalJSON } from '../src/net/cloudSave';
import { cardCatalog, cardStanding, catalogStats } from '../src/ui/cardCatalog';
import { fs, proc } from './lib/node';

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);
const read = (p: string) => fs.readFileSync(p, 'utf8') as string;

class MemSave {
  data: SaveData = defaultSave();
  save(): void {
    this.data = sanitize(JSON.parse(JSON.stringify(this.data)));
  }
  get persistent(): boolean {
    return true;
  }
  reset(): void {
    this.data = defaultSave();
  }
}
const roster = (d: SaveData) => (f: FighterId) => !!d.fighters[f]?.unlocked;

// ----------------------------------------------------------- the catalog
{
  const store = new MemSave();
  const career = new CareerSystem(store as unknown as SaveSystem);
  const groups = cardCatalog(career, store.data, roster(store.data));
  const ids = groups.flatMap((g) => g.cards.map((c) => c.id));
  // (DIRECTOR'S CUT is the champion's move in BOSS FIGHT — never a player's card, never in a deck)
  const all = (Object.keys(CARDS) as CardId[]).filter((c) => c !== 'directors_cut');
  check(`catalog: every player card exactly once (${ids.length}; the champion's DIRECTOR'S CUT is not a player card)`, ids.length === all.length && new Set(ids).size === all.length && all.every((c) => ids.includes(c)) && !ids.includes('directors_cut') && Object.keys(CARDS).length === all.length + 1);
  check('catalog: the basic six first, then the shop cards by family (attack, control, defence, show), the signatures last in roster order', groups[0].id === 'basic' && groups[0].cards.map((c) => c.id).join() === UNIVERSAL_CARDS.join() && groups.slice(1, -1).map((g) => g.id).join() === 'attack,control,defense,show' && groups[groups.length - 1].cards.map((c) => c.id).join() === FIGHTER_ORDER.map((f) => FIGHTERS[f].signature).join());
  check('catalog: the 1.9.8 cards are there — SHOWTIME (show), MAGNET PULL (control), SAFE CUT (defence) and ACE\'s MAIN EVENT (signatures)', groups.find((g) => g.id === 'show')!.cards.some((c) => c.id === 'showtime') && groups.find((g) => g.id === 'control')!.cards.some((c) => c.id === 'magnet_pull') && groups.find((g) => g.id === 'defense')!.cards.some((c) => c.id === 'safe_cut') && groups[groups.length - 1].cards.some((c) => c.id === 'main_event' && c.fighter === 'ace'));
  const st = catalogStats(groups);
  check(`a new career: the basic six and RAY's signature are yours, no shop card bought, nothing to buy at level 1 (${st.have}/${st.total}, ${st.bought}/${st.shop}, ${st.buyable})`, st.have === 7 && st.bought === 0 && st.shop === NEW_CARDS.length && st.buyable === 0);
  const sc = groups.flatMap((g) => g.cards).filter((c) => CARDS[c.id].shop);
  check('a new career: every shop card is closed with its unlock line («Уровень продюсера N…») and its career price', sc.every((c) => c.standing === 'locked' && !!c.requirement && c.requirement.startsWith('Уровень продюсера') && c.price === cardPrice(c.id)));
  check('a new career: the signatures of fighters not signed yet are closed, each with its fighter', groups[groups.length - 1].cards.every((c) => (c.fighter === 'ray' ? c.standing === 'signature' : c.standing === 'signature_locked') && FIGHTERS[c.fighter!].signature === c.id));
}
{
  // a levelled career with money: open cards are buyable or short by price; a purchase turns one into «owned»
  const store = new MemSave();
  const career = new CareerSystem(store as unknown as SaveSystem);
  store.data.reputation = 480; // level 5
  store.data.money = 1000;
  store.data.fighters.ace.unlocked = true;
  const before = catalogStats(cardCatalog(career, store.data, roster(store.data)));
  const cheap = NEW_CARDS.filter((c) => cardPrice(c) <= 1000);
  check(`level 5 with $1000: every open card is buyable when affordable, «short» otherwise (${before.buyable} buyable = ${cheap.length} priced ≤ $1000)`, before.buyable === cheap.length && NEW_CARDS.every((c) => cardStanding(career, store.data, c, roster(store.data)).standing === (cardPrice(c) <= 1000 ? 'buyable' : 'short')));
  check('ACE in the roster: MAIN EVENT reads as his signature', cardStanding(career, store.data, 'main_event', roster(store.data)).standing === 'signature');
  const ok = career.buyCard('showtime');
  const after = catalogStats(cardCatalog(career, store.data, roster(store.data)));
  check(`buying SHOWTIME (the career price $${cardPrice('showtime')}): owned, counted, the dollars gone, once only`, ok && store.data.money === 1000 - cardPrice('showtime') && cardStanding(career, store.data, 'showtime', roster(store.data)).standing === 'owned' && after.bought === 1 && after.have === before.have + 1 && !career.buyCard('showtime') && store.data.money === 1000 - cardPrice('showtime'));
  check('a bought card is in every fighter\'s deck choice — and a signature stays its fighter\'s', FIGHTER_ORDER.every((f) => career.availableCards(f).includes('showtime')) && !career.availableCards('ray').includes('main_event'));
}

// ----------------------------------------------------------- saves and the cloud
{
  // an old save (1.9.7) with bought cards and a deck: the catalog reads them as they are; nothing new is written
  const old = sanitize({ ...defaultSave(), money: 777, cards: { owned: ['spotlight_tag', 'second_take'] }, fighters: { ...defaultSave().fighters, ray: { ...defaultSave().fighters.ray, deck: ['spotlight_tag', 'second_take', 'dash', 'adrenaline'] } } });
  const store = new MemSave();
  store.data = old;
  const career = new CareerSystem(store as unknown as SaveSystem);
  const g = cardCatalog(career, store.data, roster(store.data));
  check('an old save: its bought cards read as yours, its deck and dollars untouched', ['spotlight_tag', 'second_take'].every((c) => cardStanding(career, store.data, c as CardId, roster(store.data)).standing === 'owned') && store.data.fighters.ray.deck.join() === 'spotlight_tag,second_take,dash,adrenaline' && store.data.money === 777 && catalogStats(g).bought === 2);
  check('no new save field, schema 12: the section only reads `cards.owned` (the cloud copy of a save is byte for byte the same before and after opening it)', defaultSave().version === 12 && canonicalJSON(old) === canonicalJSON(sanitize(JSON.parse(JSON.stringify(old)))) && JSON.stringify(Object.keys(defaultSave()).sort()) === JSON.stringify(Object.keys(old).sort()));
}

// ----------------------------------------------------------- the screens
{
  const prep = read('src/ui/screens/PrepScreen.ts');
  const cards = read('src/ui/screens/CardsScreen.ts');
  const menu = read('src/ui/screens/MenuScreen.ts');
  const game = read('src/game/Game.ts');
  check('the prep screen builds the deck only: no purchase there any more (no buy button, no buyCard), a link to the CARDS section that keeps the deck', !prep.includes('buyCard(') && !prep.includes('data-act="buy"') && !prep.includes('shopSection') && prep.includes("g.goto('cards', { back: 'prep' })") && prep.includes('if (this.deck.length === 4) g.career.setDeck(g.save.data.selected, this.deck);'));
  check('the CARDS section buys through the career (canBuyCard / buyCard) and returns where it was opened from', cards.includes('g.career.canBuyCard(c)') && cards.includes('g.career.buyCard(c)') && cards.includes('g.goto(this.back)'));
  check('the main menu opens it (a tile beside PRIME SHOP, a dot with what can be bought now) and the game registers the screen', menu.includes('data-act="cards"') && menu.includes("this.g.goto('cards', { back: 'menu' })") && menu.includes('<div class="menu-shops">${shopEntry}${cardsEntry}</div>') && game.includes("this.ui.register('cards', new CardsScreen(this));"));
  check('one card description everywhere (the shared cardDetailHTML in the section and the prep screen)', prep.includes('cardDetailHTML(') && cards.includes('cardDetailHTML(') && read('src/ui/cardCatalog.ts').includes('export function cardDetailHTML('));
}

let failed = 0;
for (const [name, pass] of checks) {
  if (!pass) failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}`);
}
console.log(failed ? `\ncardsmenu: FAILED (${failed} of ${checks.length})` : `\ncardsmenu: OK (${checks.length} checks)`);
proc.exit(failed ? 1 : 0);
