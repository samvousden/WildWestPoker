import React, { useState, useMemo } from 'react';
import { useGame } from '../context/GameContext';
import {
  ShopItemType,
  UseItemType,
  HandPhase,
  getBondCashOutValue,
  cardToDisplayString,
  isJokerCard,
  BondState,
  StockOptionState,
  LuckBuff,
  Card,
} from '@poker/shared';
import { CardDisplay } from './CardDisplay';

// ── Grid constants ──────────────────────────────────────────────────────────
const COLS = 4;
const ROWS = 3;
const TOTAL = COLS * ROWS; // 12 slots per section

// ── Entry types ─────────────────────────────────────────────────────────────
type ActiveEntry =
  | { id: string; kind: 'gun'; bullets: number }
  | { id: string; kind: 'xray'; charges: number; peeked: boolean }
  | { id: string; kind: 'camera'; charges: number }
  | { id: string; kind: 'sleeve'; slotIndex: 0 | 1; card: Card; usedThisHand: boolean }
  | { id: string; kind: 'bond'; index: number; bond: BondState }
  | { id: string; kind: 'stockOption'; index: number; option: StockOptionState };

type PassiveEntry =
  | { id: string; kind: 'cardSleeveUnlock' }
  | { id: string; kind: 'sleeveExtender' }
  | { id: string; kind: 'rake' }
  | { id: string; kind: 'fourLeafClover' }
  | { id: string; kind: 'fiveLeafClover' }
  | { id: string; kind: 'cigarette'; buff: LuckBuff }
  | { id: string; kind: 'whiskey'; buff: LuckBuff };

// ── Passive item metadata ────────────────────────────────────────────────────
const PASSIVE_BASE_META: Record<PassiveEntry['kind'], { label: string; icon: string; baseTooltip: string }> = {
  cardSleeveUnlock: { icon: '🃏', label: 'Big Sleeves',   baseTooltip: 'Lets you hide one card in your sleeve to swap with a hole card.' },
  sleeveExtender:   { icon: '✉️', label: 'Bigger Sleeves', baseTooltip: 'Expands your sleeve to hold a second hidden card.' },
  rake:             { icon: '🪣', label: 'Rake',          baseTooltip: 'Secretly takes 5% of every pot you are in.' },
  fourLeafClover:   { icon: '🍀', label: '4-Leaf Clover', baseTooltip: 'Permanently grants +7 luck.' },
  fiveLeafClover:   { icon: '🌟', label: '5-Leaf Clover', baseTooltip: 'Locks your luck stat to 77 forever. Cigarettes and whiskey have no further effect.' },
  cigarette:        { icon: '🚬', label: 'Cigarette',     baseTooltip: '+5 luck buff active. Expires after {n} hand(s).' },
  whiskey:          { icon: '🥃', label: 'Whiskey',       baseTooltip: '+10 luck buff active. Expires after {n} hand(s).' },
};

// ── Component ────────────────────────────────────────────────────────────────
interface ItemBagProps {
  section?: 'active' | 'passive';
}

export const ItemBag: React.FC<ItemBagProps> = ({ section }) => {
  const {
    gameState, playerId,
    hasGun, bullets,
    xrayCharges, peekedCard,
    hiddenCameraCharges, revealedCards,
    sleeveCard, sleeveCard2, sleeveUsedThisHand,
    holeCards,
    bonds, stockOptions,
    luckBuffs,
    useItem, useXRay, useHiddenCamera, shootPlayer, cashOutBond, cashOutStockOption,
  } = useGame();

  // Which active slot is in "pick-a-target" mode
  const [targetingId, setTargetingId] = useState<string | null>(null);

  const myInventory: number[] = useMemo(
    () => gameState?.players.find(p => p.id === playerId)?.inventory ?? [],
    [gameState, playerId],
  );

  const canSwapSleeve =
    !sleeveUsedThisHand && gameState?.phase === HandPhase.Betting;

  // ── Build active entries ────────────────────────────────────────────────
  const activeEntries = useMemo<ActiveEntry[]>(() => {
    const e: ActiveEntry[] = [];
    if (hasGun) e.push({ id: 'gun', kind: 'gun', bullets });
    if (xrayCharges > 0 || peekedCard !== null)
      e.push({ id: 'xray', kind: 'xray', charges: xrayCharges, peeked: peekedCard !== null });
    if (hiddenCameraCharges > 0 || revealedCards.size > 0)
      e.push({ id: 'camera', kind: 'camera', charges: hiddenCameraCharges });
    if (sleeveCard)
      e.push({ id: 'sleeve-0', kind: 'sleeve', slotIndex: 0, card: sleeveCard, usedThisHand: sleeveUsedThisHand });
    if (sleeveCard2)
      e.push({ id: 'sleeve-1', kind: 'sleeve', slotIndex: 1, card: sleeveCard2, usedThisHand: sleeveUsedThisHand });
    bonds.forEach((bond, i) => e.push({ id: `bond-${i}`, kind: 'bond', index: i, bond }));
    stockOptions.forEach((opt, i) => e.push({ id: `stock-${i}`, kind: 'stockOption', index: i, option: opt }));
    return e;
  }, [hasGun, bullets, xrayCharges, peekedCard, hiddenCameraCharges, revealedCards.size,
      sleeveCard, sleeveCard2, sleeveUsedThisHand, bonds, stockOptions]);

  // ── Build passive entries ───────────────────────────────────────────────
  const passiveEntries = useMemo<PassiveEntry[]>(() => {
    const e: PassiveEntry[] = [];
    if (myInventory.includes(ShopItemType.CardSleeveUnlock))
      e.push({ id: 'cardSleeve', kind: 'cardSleeveUnlock' });
    if (myInventory.includes(ShopItemType.SleeveExtender))
      e.push({ id: 'sleevExt', kind: 'sleeveExtender' });
    if (myInventory.includes(ShopItemType.Rake))
      e.push({ id: 'rake', kind: 'rake' });
    if (myInventory.includes(ShopItemType.FourLeafClover))
      e.push({ id: 'four', kind: 'fourLeafClover' });
    if (myInventory.includes(ShopItemType.FiveLeafClover))
      e.push({ id: 'five', kind: 'fiveLeafClover' });
    luckBuffs.forEach((buff, i) => {
      if (buff.amount === 5)  e.push({ id: `cig-${i}`,   kind: 'cigarette', buff });
      if (buff.amount === 10) e.push({ id: `whisk-${i}`, kind: 'whiskey',   buff });
    });
    return e;
  }, [myInventory, luckBuffs]);

  // ── Helpers ─────────────────────────────────────────────────────────────
  const opponents = useMemo(
    () => gameState?.players.filter(p => p.id !== playerId && p.isInHand && !p.hasFolded) ?? [],
    [gameState, playerId],
  );

  const handleGunShoot = (targetId: number) => {
    shootPlayer(targetId);
    setTargetingId(null);
  };

  const handleCameraUse = (targetId: number) => {
    useHiddenCamera(targetId);
    setTargetingId(null);
  };

  // ── Render helpers ──────────────────────────────────────────────────────
  function renderTargetPicker(onPick: (id: number) => void, disabledIds?: Set<number>) {
    return (
      <div className="item-bag-targets">
        {opponents.length === 0
          ? <span className="item-bag-no-targets">No targets</span>
          : opponents.map(p => (
              <button
                key={p.id}
                className="item-bag-target-btn"
                onClick={() => onPick(p.id)}
                disabled={disabledIds?.has(p.id)}
              >
                {p.name}
              </button>
            ))
        }
        <button className="item-bag-cancel-btn" onClick={() => setTargetingId(null)}>✕</button>
      </div>
    );
  }

  function renderActiveSlot(entry: ActiveEntry) {
    const isTargeting = targetingId === entry.id;

    switch (entry.kind) {
      case 'gun': {
        if (isTargeting) return renderTargetPicker(handleGunShoot);
        return (
          <div className="item-bag-cell-content">
            <span className="item-bag-icon">🔫</span>
            <span className="item-bag-label">Gun</span>
            {entry.bullets > 0 && <span className="item-bag-badge">×{entry.bullets}</span>}
            <button
              className="item-bag-use-btn"
              onClick={() => setTargetingId(entry.id)}
              disabled={entry.bullets === 0}
            >
              Shoot
            </button>
          </div>
        );
      }

      case 'xray': {
        const used = entry.charges === 0;
        return (
          <div className="item-bag-cell-content">
            <span className="item-bag-icon">🔍</span>
            <span className="item-bag-label">X-Ray</span>
            <span className="item-bag-badge">×{entry.charges}</span>
            {peekedCard && (
              <div className="item-bag-peeked-card">
                <CardDisplay card={peekedCard} className="item-bag-card" mode="display" />
              </div>
            )}
            <button
              className="item-bag-use-btn"
              onClick={useXRay}
              disabled={used || entry.peeked}
            >
              {entry.peeked ? 'Peeked' : 'Use'}
            </button>
          </div>
        );
      }

      case 'camera': {
        if (isTargeting) return renderTargetPicker(handleCameraUse, revealedCards as unknown as Set<number>);
        const used = entry.charges === 0;
        return (
          <div className="item-bag-cell-content">
            <span className="item-bag-icon">📷</span>
            <span className="item-bag-label">Camera</span>
            <span className="item-bag-badge">×{entry.charges}</span>
            <button
              className="item-bag-use-btn"
              onClick={() => setTargetingId(entry.id)}
              disabled={used}
            >
              Spy
            </button>
          </div>
        );
      }

      case 'sleeve': {
        const swapA = entry.slotIndex === 0 ? UseItemType.UseSleeveCardSwapHoleA : UseItemType.UseSleeveCard2SwapHoleA;
        const swapB = entry.slotIndex === 0 ? UseItemType.UseSleeveCardSwapHoleB : UseItemType.UseSleeveCard2SwapHoleB;
        const cardLabel = isJokerCard(entry.card) ? 'Joker' : 'Card';
        return (
          <div className="item-bag-cell-content item-bag-sleeve-cell">
            {/* <span className="item-bag-label">{cardLabel} {entry.slotIndex + 1}</span> */}
            <div className="item-bag-sleeve-card">
              <CardDisplay card={entry.card} className="item-bag-card" mode="display" />
            </div>
            {canSwapSleeve && holeCards && holeCards.length === 2 ? (
              <div className="item-bag-swap-row">
                <button className="item-bag-swap-btn" onClick={() => useItem(swapA)} title={`Swap with ${cardToDisplayString(holeCards[0])}`}>→A</button>
                <button className="item-bag-swap-btn" onClick={() => useItem(swapB)} title={`Swap with ${cardToDisplayString(holeCards[1])}`}>→B</button>
              </div>
            ) : (
              <button className="item-bag-use-btn" disabled>
                {entry.usedThisHand ? 'Used' : 'Bet phase'}
              </button>
            )}
          </div>
        );
      }

      case 'bond': {
        const value = getBondCashOutValue(entry.bond);
        return (
          <div className="item-bag-cell-content">
            <span className="item-bag-icon">📄</span>
            <span className="item-bag-label">Bond</span>
            <span className="item-bag-hint">${value}</span>
            <button className="item-bag-use-btn" onClick={() => cashOutBond(entry.index)}>
              Cash Out
            </button>
          </div>
        );
      }

      case 'stockOption': {
        const ready = entry.option.roundsHeld >= 3;
        const handsLeft = 3 - entry.option.roundsHeld;
        return (
          <div className="item-bag-cell-content">
            <span className="item-bag-icon">📈</span>
            <span className="item-bag-label">Stock</span>
            <span className="item-bag-hint">{ready ? 'Ready!' : `${handsLeft}h left`}</span>
            <button
              className="item-bag-use-btn"
              onClick={() => cashOutStockOption(entry.index)}
              disabled={!ready}
            >
              {ready ? 'Cash Out' : 'Waiting'}
            </button>
          </div>
        );
      }
    }
  }

  function renderPassiveSlot(entry: PassiveEntry) {
    const base = PASSIVE_BASE_META[entry.kind];
    const handsLeft = (entry.kind === 'cigarette' || entry.kind === 'whiskey') ? entry.buff.turnsRemaining : null;
    const tooltip = handsLeft !== null
      ? base.baseTooltip.replace('{n}', String(handsLeft))
      : base.baseTooltip;
    const extra = handsLeft !== null ? ` (${handsLeft}h)` : '';
    return (
      <div className="item-bag-cell-content item-bag-passive" title={tooltip}>
        <span className="item-bag-icon">{base.icon}</span>
        <span className="item-bag-label">{base.label}{extra}</span>
      </div>
    );
  }

  function renderGrid<T extends { id: string }>(
    entries: T[],
    renderSlot: (e: T) => React.ReactNode,
  ) {
    return (
      <div className="item-bag-grid">
        {Array.from({ length: TOTAL }, (_, i) => {
          const entry = entries[i];
          return (
            <div
              key={entry?.id ?? `empty-${i}`}
              className={`item-bag-slot${entry ? ' item-bag-slot--filled' : ' item-bag-slot--empty'}`}
            >
              {entry ? renderSlot(entry) : null}
            </div>
          );
        })}
      </div>
    );
  }

  if (section === 'active') {
    return (
      <div className="item-bag">
        <h3 className="item-bag-title">Active Items</h3>
        <div className="item-bag-section">
          {renderGrid(activeEntries, renderActiveSlot)}
        </div>
        {activeEntries.length === 0 && (
          <p className="item-bag-empty-msg">No active items</p>
        )}
      </div>
    );
  }

  if (section === 'passive') {
    return (
      <div className="item-bag">
        <h3 className="item-bag-title">Passive Items</h3>
        <div className="item-bag-section">
          {renderGrid(passiveEntries, renderPassiveSlot)}
        </div>
        {passiveEntries.length === 0 && (
          <p className="item-bag-empty-msg">No passive items</p>
        )}
      </div>
    );
  }

  // No section prop: render both (legacy / ItemShop fallback)
  const hasContent = activeEntries.length > 0 || passiveEntries.length > 0;
  return (
    <div className="item-bag">
      <h3 className="item-bag-title">Item Bag</h3>
      <div className="item-bag-section">
        <div className="item-bag-section-label">Active</div>
        {renderGrid(activeEntries, renderActiveSlot)}
      </div>
      <div className="item-bag-section">
        <div className="item-bag-section-label">Passive</div>
        {renderGrid(passiveEntries, renderPassiveSlot)}
      </div>
      {!hasContent && (
        <p className="item-bag-empty-msg">No items yet</p>
      )}
    </div>
  );
};
