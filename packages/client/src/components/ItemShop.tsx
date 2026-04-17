import React, { useState, useCallback, useEffect } from 'react';
import { useGame } from '../context/GameContext';
import { Card, ShopItemType, ShopSlotItem, cardToDisplayString } from '@poker/shared';
import { ShopSlot } from './ShopSlot';

const REFRESH_SHOP_COST = 50;
const SLOT_UNLOCK_COSTS = [0, 50, 200] as const; // index = slot position

interface ReplacePending {
  card: Card;
  shopSlotIndex: number;
  isJoker: boolean;
}

export const ItemShop: React.FC = () => {
  const { gameState, socket, playerId, setReady, sleeveCard, sleeveCard2 } = useGame();
  const [shopSlots, setShopSlots] = useState<ShopSlotItem[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [boughtIndices, setBoughtIndices] = useState<Set<number>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [replacePending, setReplacePending] = useState<ReplacePending | null>(null);

  if (!gameState) {
    return <div>Loading...</div>;
  }

  const currentPlayer = gameState.players.find(p => p.id === playerId);
  const allReady = gameState.players.length >= 2 && gameState.players.every(p => p.isReady);
  const hasSleeveExtender = currentPlayer?.inventory.includes(ShopItemType.SleeveExtender) ?? false;

  // Load shop slots when entering shop
  useEffect(() => {
    if (!socket || !playerId) return;
    setIsLoadingSlots(true);
    setBoughtIndices(new Set());
    socket.emit('get-shop-slots', playerId, (response: any) => {
      setIsLoadingSlots(false);
      if (response.success) {
        setShopSlots(response.slots);
      }
    });
  }, [socket, playerId]);

  const handleContinue = () => {
    setReady(true);
  };

  const handleUnlockSlot = useCallback((slotIndex: number) => {
    if (!socket || !playerId) return;
    socket.emit('unlock-shop-slot', playerId, (response: any) => {
      if (response.success) {
        setShopSlots(response.slots);
      } else {
        alert(response.error || 'Cannot unlock slot');
      }
    });
  }, [socket, playerId]);

  const handleRefreshShop = useCallback(() => {
    if (!socket || !playerId) return;
    setIsRefreshing(true);
    socket.emit('refresh-shop', playerId, (response: any) => {
      setIsRefreshing(false);
      if (response.success) {
        setShopSlots(response.slots);
        setBoughtIndices(new Set());
      } else {
        alert(response.error || 'Cannot refresh shop');
      }
    });
  }, [socket, playerId]);

  const emitBuyCard = useCallback((card: Card, shopSlotIndex: number, targetSlot?: 0 | 1) => {
    if (!socket || !playerId) return;
    const args: any[] = [playerId, card];
    if (targetSlot !== undefined) args.push(targetSlot);
    args.push((response: any) => {
      if (response.success) {
        setBoughtIndices(prev => new Set(prev).add(shopSlotIndex));
      } else {
        alert(`Failed to purchase: ${response.error}`);
      }
    });
    socket.emit('buy-extra-card', ...args);
  }, [socket, playerId]);

  const emitBuyJoker = useCallback((shopSlotIndex: number, targetSlot?: 0 | 1) => {
    if (!socket || !playerId) return;
    const args: any[] = [playerId, ShopItemType.Joker];
    if (targetSlot !== undefined) args.push(targetSlot);
    args.push((response: any) => {
      if (response.success) {
        setBoughtIndices(prev => new Set(prev).add(shopSlotIndex));
      } else {
        alert(`Failed to purchase: ${response.error}`);
      }
    });
    socket.emit('buy-item', ...args);
  }, [socket, playerId]);

  const handleBuyItem = useCallback((slotType: ShopItemType, slotIndex: number, previewCard?: Card) => {
    if (!socket || !playerId) return;

    const bothSlotsFull = sleeveCard !== null && sleeveCard2 !== null;

    if (slotType === ShopItemType.ExtraCard && previewCard) {
      if (bothSlotsFull && hasSleeveExtender) {
        setReplacePending({ card: previewCard, shopSlotIndex: slotIndex, isJoker: false });
      } else {
        emitBuyCard(previewCard, slotIndex);
      }
    } else if (slotType === ShopItemType.Joker) {
      if (bothSlotsFull && hasSleeveExtender) {
        setReplacePending({ card: null as unknown as Card, shopSlotIndex: slotIndex, isJoker: true });
      } else {
        emitBuyJoker(slotIndex);
      }
    } else {
      socket.emit('buy-item', playerId, slotType, (response: any) => {
        if (response.success) {
          setBoughtIndices(prev => new Set(prev).add(slotIndex));
        } else {
          alert(`Failed to purchase: ${response.error}`);
        }
      });
    }
  }, [socket, playerId, sleeveCard, sleeveCard2, hasSleeveExtender, emitBuyCard, emitBuyJoker]);

  const handleReplaceSlot = useCallback((targetSlot: 0 | 1) => {
    if (!replacePending) return;
    if (replacePending.isJoker) {
      emitBuyJoker(replacePending.shopSlotIndex, targetSlot);
    } else {
      emitBuyCard(replacePending.card, replacePending.shopSlotIndex, targetSlot);
    }
    setReplacePending(null);
  }, [replacePending, emitBuyCard, emitBuyJoker]);


  return (
    <div className="item-shop">
      <div className="shop-header">
        <h1>Item Shop</h1>
        <p className="player-info">
          {currentPlayer?.name} - Stack: ${currentPlayer?.stack}
        </p>
      </div>

      <div className="items-grid">
        {isLoadingSlots ? (
          <div className="shop-loading">Loading shop...</div>
        ) : shopSlots.length === 0 ? (
          <div className="shop-empty">No items available</div>
        ) : (
          shopSlots.map((slot, i) => (
            <ShopSlot
              key={i}
              slot={slot}
              index={i}
              bought={boughtIndices.has(i)}
              canAfford={(currentPlayer?.stack || 0) >= slot.price}
              onBuy={handleBuyItem}
              onUnlock={() => handleUnlockSlot(i)}
              unlockCost={SLOT_UNLOCK_COSTS[i]}
              canAffordUnlock={(currentPlayer?.stack || 0) >= SLOT_UNLOCK_COSTS[i]}
            />
          ))
        )}
      </div>

      <div className="shop-refresh">
        <button
          className="refresh-shop-btn"
          onClick={handleRefreshShop}
          disabled={isRefreshing || (currentPlayer?.stack ?? 0) < REFRESH_SHOP_COST}
        >
          {isRefreshing ? 'Refreshing...' : `Refresh Shop ($${REFRESH_SHOP_COST})`}
        </button>
      </div>

      <div className="players-status">
        <h3>Players Ready:</h3>
        {gameState.players.map(p => (
          <div key={p.id} className="player-ready-status">
            {p.name} {p.isReady && '✓'}
          </div>
        ))}
      </div>

      <div className="shop-footer">
        {!allReady ? (
          <button onClick={handleContinue} className="continue-btn">
            Continue to Next Hand
          </button>
        ) : (
          <p className="waiting-message">All players ready - starting next hand...</p>
        )}
      </div>

      {replacePending && (
        <div className="replace-sleeve-overlay" onClick={() => setReplacePending(null)}>
          <div className="replace-sleeve-dialog" onClick={e => e.stopPropagation()}>
            <h2>Both sleeve slots are full</h2>
            <p>Choose a slot to replace:</p>
            <div className="replace-sleeve-options">
              <button className="replace-slot-btn" onClick={() => handleReplaceSlot(0)}>
                <span className="replace-slot-label">Slot 1</span>
                <span className="replace-slot-card">
                  {sleeveCard ? cardToDisplayString(sleeveCard) : '—'}
                </span>
                <span className="replace-slot-arrow">↓ Replace</span>
              </button>
              <button className="replace-slot-btn" onClick={() => handleReplaceSlot(1)}>
                <span className="replace-slot-label">Slot 2</span>
                <span className="replace-slot-card">
                  {sleeveCard2 ? cardToDisplayString(sleeveCard2) : '—'}
                </span>
                <span className="replace-slot-arrow">↓ Replace</span>
              </button>
            </div>
            <button className="replace-cancel-btn" onClick={() => setReplacePending(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
};
