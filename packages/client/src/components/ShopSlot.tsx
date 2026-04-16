import React from 'react';
import { Card, ShopItemRarity, ShopItemType, ShopSlotItem } from '@poker/shared';
import { CardDisplay } from './CardDisplay';

interface ShopSlotProps {
  slot: ShopSlotItem;
  index: number;
  bought: boolean;
  canAfford: boolean;
  onBuy: (type: ShopItemType, index: number, previewCard?: Card) => void;
  onUnlock?: () => void;
  unlockCost?: number;
  canAffordUnlock?: boolean;
}

const rarityLabel = (rarity: ShopItemRarity): string => {
  switch (rarity) {
    case ShopItemRarity.Rare: return 'Rare';
    case ShopItemRarity.Uncommon: return 'Uncommon';
    default: return 'Common';
  }
};

export const ShopSlot: React.FC<ShopSlotProps> = ({ slot, index, bought, canAfford, onBuy, onUnlock, unlockCost, canAffordUnlock }) => {
  if (slot.locked) {
    return (
      <div className="item-slot item-slot-locked">
        <div className="item-card">
          <div className="locked-slot-content">
            <span className="locked-icon">🔒</span>
            <p className="locked-label">Slot Locked</p>
            <button
              className="unlock-btn"
              onClick={onUnlock}
              disabled={!canAffordUnlock}
            >
              {canAffordUnlock ? `Unlock for $${unlockCost}` : `Unlock ($${unlockCost}) — Insufficient Funds`}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`item-slot${bought ? ' item-slot-bought' : ''}`}>
      <div className="item-card">
        <div className="item-card-header">
          <h3>{slot.name}</h3>
          <span className={`rarity-badge rarity-${slot.rarity}`}>{rarityLabel(slot.rarity)}</span>
        </div>
        <p className="item-description">{slot.description}</p>

        {slot.type === ShopItemType.ExtraCard ? (
          slot.previewCard ? (
            <>
              <div className="card-preview">
                <CardDisplay card={slot.previewCard} mode="display" />
                <p className="item-price">${slot.price}</p>
              </div>
              <button
                className="buy-btn"
                onClick={() => onBuy(slot.type, index, slot.previewCard!)}
                disabled={bought || !canAfford}
              >
                {bought ? 'Purchased' : canAfford ? 'Buy This Card' : 'Insufficient Funds'}
              </button>
            </>
          ) : (
            <p className="item-price">$30-$50</p>
          )
        ) : slot.type === ShopItemType.Joker ? (
          <>
            <div className="card-preview joker-preview">
              <div className="card-display joker-display">
                <span className="card-name">🃏</span>
              </div>
              <p className="item-price">${slot.price}</p>
            </div>
            <button
              className="buy-btn"
              onClick={() => onBuy(slot.type, index)}
              disabled={bought || !canAfford}
            >
              {bought ? 'Purchased' : canAfford ? 'Buy' : 'Insufficient Funds'}
            </button>
          </>
        ) : (
          <>
            <p className="item-price">${slot.price}</p>
            <button
              className="buy-btn"
              onClick={() => onBuy(slot.type, index)}
              disabled={bought || !canAfford}
            >
              {bought ? 'Purchased' : canAfford ? 'Buy' : 'Insufficient Funds'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};
