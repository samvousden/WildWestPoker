import React, { useState, useCallback, useEffect } from 'react';
import { useGame } from '../context/GameContext';
import { Card, ShopItemType, ShopSlotItem } from '@poker/shared';
import { ShopSlot } from './ShopSlot';

const REFRESH_SHOP_COST = 50;
const SLOT_UNLOCK_COSTS = [0, 50, 200] as const; // index = slot position

export const ItemShop: React.FC = () => {
  const { gameState, socket, playerId, setReady } = useGame();
  const [shopSlots, setShopSlots] = useState<ShopSlotItem[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [boughtIndices, setBoughtIndices] = useState<Set<number>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);

  if (!gameState) {
    return <div>Loading...</div>;
  }

  const currentPlayer = gameState.players.find(p => p.id === playerId);
  const allReady = gameState.players.length >= 2 && gameState.players.every(p => p.isReady);

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

  const handleBuyItem = useCallback((slotType: ShopItemType, slotIndex: number, previewCard?: Card) => {
    if (!socket || !playerId) return;

    if (slotType === ShopItemType.ExtraCard && previewCard) {
      socket.emit('buy-extra-card', playerId, previewCard, (response: any) => {
        if (response.success) {
          setBoughtIndices(prev => new Set(prev).add(slotIndex));
        } else {
          alert(`Failed to purchase: ${response.error}`);
        }
      });
    } else {
      socket.emit('buy-item', playerId, slotType, (response: any) => {
        if (response.success) {
          setBoughtIndices(prev => new Set(prev).add(slotIndex));
        } else {
          alert(`Failed to purchase: ${response.error}`);
        }
      });
    }
  }, [socket, playerId]);


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
    </div>
  );
};
