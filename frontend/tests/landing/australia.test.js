import { describe, it, expect } from 'vitest';
import {
  DOTS, GRID_PATH, HUBS, LONGEST_CHIP_NAME, SPACING, VIEW, layoutEcosystem, litRadius, onLand, project,
} from '../../src/components/landing/australia.js';

const hub = (id) => HUBS.find((h) => h.id === id);
const pinAt = (name, lat, lng) => [name.toLowerCase(), name, lat, lng, 'SaaS', 'Sydney', 1, ''];
const inSydney = (name = 'Sydney Co') => pinAt(name, -33.87, 151.21);
const inMelbourne = (name = 'Melbourne Co') => pinAt(name, -37.81, 144.96);
const company = (name, city, extra = {}) => ({ name, slug: name.toLowerCase(), city, hiring: true, ...extra });

describe('the outline of Australia', () => {
  it('has every capital the picture labels on land', () => {
    for (const h of HUBS) expect(onLand(h.lat, h.lng), h.name).toBe(true);
  });

  it('leaves the sea around it, and the gulf and the strait inside it, off the land', () => {
    const sea = {
      'Indian Ocean': [-30, 100], 'Tasman Sea': [-38, 160], 'Southern Ocean': [-46, 140],
      'Gulf of Carpentaria': [-14.5, 139.5], 'Timor Sea': [-11, 128], 'Bass Strait': [-39.8, 146.5],
      'Coral Sea': [-17, 150], 'Great Australian Bight': [-35.5, 130],
    };
    for (const [name, [lat, lng]] of Object.entries(sea)) expect(onLand(lat, lng), name).toBe(false);
  });

  it('has the inland and the far coast on land', () => {
    const land = {
      'Alice Springs': [-23.7, 133.88], Uluru: [-25.34, 131.04], Kalgoorlie: [-30.75, 121.47], Cairns: [-16.92, 145.77],
      Townsville: [-19.26, 146.82], Broome: [-17.96, 122.24], Newcastle: [-32.93, 151.78], Launceston: [-41.43, 147.14],
    };
    for (const [name, [lat, lng]] of Object.entries(land)) expect(onLand(lat, lng), name).toBe(true);
  });

  it('draws north above south and west left of east', () => {
    expect(project(-12, 131).y).toBeLessThan(project(-40, 147).y);
    expect(project(-30, 115).x).toBeLessThan(project(-30, 153).x);
  });
});

describe('the dots', () => {
  it('are a country\'s worth, inside the picture, and never nearer each other than their spacing', () => {
    expect(DOTS.length).toBeGreaterThan(800);
    expect(DOTS.length).toBeLessThan(1600);
    for (const d of DOTS) {
      expect(d.x).toBeGreaterThan(0);
      expect(d.x).toBeLessThan(VIEW.width);
      expect(d.y).toBeGreaterThan(0);
      expect(d.y).toBeLessThan(VIEW.height);
    }
    let nearest = Infinity;
    for (let i = 0; i < DOTS.length; i += 1) {
      for (let j = i + 1; j < DOTS.length; j += 1) nearest = Math.min(nearest, Math.hypot(DOTS[i].x - DOTS[j].x, DOTS[i].y - DOTS[j].y));
    }
    expect(nearest).toBeGreaterThan(SPACING - 0.5);
  });

  it('are drawn as one path, a dot each', () => {
    expect(GRID_PATH.startsWith('M')).toBe(true);
    expect(GRID_PATH.match(/M/g)).toHaveLength(DOTS.length);
  });

  it('grow with the count of startups, and stop growing', () => {
    expect(litRadius(1)).toBeLessThan(litRadius(15));
    expect(litRadius(15)).toBeLessThan(litRadius(60));
    expect(litRadius(500)).toBe(litRadius(5000));
  });
});

describe('layoutEcosystem', () => {
  it('draws nothing it was not given', () => {
    const empty = { lit: [], hubs: [], links: [], chips: [], placed: 0 };
    expect(layoutEcosystem()).toEqual(empty);
    expect(layoutEcosystem({})).toEqual(empty);
    expect(layoutEcosystem({ pins: [], areas: [], companies: [company('Canva', 'Sydney')] })).toEqual(empty);
  });

  it('lights a dot for every pin that lands on the drawing, and counts the pins in each', () => {
    const art = layoutEcosystem({ pins: [inSydney('A'), inSydney('B'), inSydney('C'), inMelbourne(), pinAt('Perth Co', -31.95, 115.86)] });
    expect(art.placed).toBe(5);
    expect(art.lit.reduce((sum, dot) => sum + dot.count, 0)).toBe(5);
    expect(art.lit[0].count).toBe(3); // the busiest first
    expect(art.lit[0].r).toBeGreaterThan(art.lit[1].r);
  });

  it('puts every capital\'s own pin on a dot', () => {
    const art = layoutEcosystem({ pins: HUBS.map((h) => pinAt(h.name, h.lat, h.lng)) });
    expect(art.placed).toBe(HUBS.length);
  });

  it('leaves out a pin that is in the sea or has no place', () => {
    const art = layoutEcosystem({
      pins: [pinAt('Ship', -30, 100), ['nothing', 'Nothing'], pinAt('NaN', Number.NaN, Number.NaN), null, undefined, pinAt('Text', 'north', 'east')],
    });
    expect(art.placed).toBe(0);
    expect(art.lit).toEqual([]);
  });

  it('counts a capital\'s startups from its pins and its city-level groups, and rings a capital known only by groups', () => {
    const art = layoutEcosystem({
      pins: [inSydney('A'), inSydney('B')],
      areas: [{ lat: hub('sydney').lat, lng: hub('sydney').lng, count: 34 }, { lat: hub('hobart').lat, lng: hub('hobart').lng, count: 1 }],
    });
    const byId = Object.fromEntries(art.hubs.map((h) => [h.id, h]));
    expect(byId.sydney.count).toBe(36);
    expect(byId.sydney.cityOnly).toBe(false);
    expect(byId.hobart.count).toBe(1);
    expect(byId.hobart.cityOnly).toBe(true); // no pin: a ring, never a dot
    expect(art.lit).toHaveLength(1);
    expect(art.placed).toBe(2);
  });

  it('ignores a group that is not near a capital', () => {
    const art = layoutEcosystem({ areas: [{ lat: -23.7, lng: 133.88, count: 9 }, { lat: Number.NaN, lng: 1, count: 2 }] });
    expect(art.hubs).toEqual([]);
  });

  it('joins only capitals that both have startups', () => {
    const three = layoutEcosystem({ pins: [inSydney(), inMelbourne(), pinAt('Brisbane Co', -27.47, 153.03)] });
    expect(three.links.map((l) => l.id)).toEqual(['brisbane-sydney', 'sydney-melbourne']);
    expect(layoutEcosystem({ pins: [inSydney()] }).links).toEqual([]);
    for (const link of three.links) expect(link.d).toMatch(/^M[\d.]+ [\d.]+Q[\d.]+ [\d.]+ [\d.]+ [\d.]+$/);
  });

  describe('naming companies', () => {
    const pins = [inSydney(), inMelbourne(), pinAt('Canberra Co', -35.28, 149.13)];

    it('names the first company of each capital whose name fits a chip, and says whether it is hiring', () => {
      const long = company('Gilmour Space Technologies', 'Sydney');
      expect(long.name.length).toBeGreaterThan(LONGEST_CHIP_NAME);
      const art = layoutEcosystem({
        pins,
        companies: [long, company('Canva', 'Sydney'), company('Atlassian', 'sydney'), company('Airwallex', 'Melbourne', { hiring: false })],
      });
      expect(art.chips.map((c) => c.company.name)).toEqual(['Canva', 'Airwallex']);
      expect(art.chips.map((c) => c.hiring)).toEqual([true, false]);
    });

    it('names nobody at a capital that has no company to name, or no room for a chip', () => {
      const art = layoutEcosystem({
        pins: [...pins, pinAt('Adelaide Co', -34.93, 138.6)],
        companies: [company('Goterra', 'Canberra'), company('Canva', 'Sydney')],
      });
      expect(art.chips.map((c) => c.hubId)).toEqual(['sydney']); // Canberra has no chip place, Adelaide no company
    });

    it('names no one in a capital with no startups on the drawing', () => {
      const art = layoutEcosystem({ pins: [inSydney()], companies: [company('Airwallex', 'Melbourne')] });
      expect(art.chips).toEqual([]);
    });

    it('does not name a company that has no name, and does not invent one', () => {
      const art = layoutEcosystem({ pins, companies: [{ city: 'Sydney' }, null, company('', 'Sydney')] });
      expect(art.chips).toEqual([]);
    });

    it('hangs the chip beside its capital, with a line back to the capital\'s dot', () => {
      const art = layoutEcosystem({ pins, companies: [company('Canva', 'Sydney')] });
      const [chip] = art.chips;
      const sydney = art.hubs.find((h) => h.id === 'sydney');
      expect(chip.fromX).toBe(sydney.x);
      expect(chip.fromY).toBe(sydney.y);
      expect(chip.side).toBe('left');
      expect(chip.x).toBeLessThan(sydney.x);
    });

    it('does not call a company hiring unless it says so', () => {
      const art = layoutEcosystem({ pins, companies: [company('Canva', 'Sydney', { hiring: 'yes' })] });
      expect(art.chips[0].hiring).toBe(false);
    });
  });
});
