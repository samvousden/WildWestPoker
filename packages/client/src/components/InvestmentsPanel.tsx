import React from 'react';
import { useGame } from '../context/GameContext';
import { getBondCashOutValue } from '@poker/shared';

export const InvestmentsPanel: React.FC = () => {
  const { totalLuck, luckBuffs, bonds, stockOptions, cashOutBond, cashOutStockOption } = useGame();

  if (totalLuck <= 0 && bonds.length === 0 && stockOptions.length === 0) return null;

  return (
    <div className="investments-section">
      {totalLuck > 0 && (
        <div className="luck-display">
          🍀 Luck: {totalLuck}
          {luckBuffs.length > 0 && (
            <span className="luck-buffs">
              {luckBuffs.map((b, i) => (
                <span key={i} className="luck-buff-tag">+{b.amount} ({b.turnsRemaining}h)</span>
              ))}
            </span>
          )}
        </div>
      )}

      {bonds.length > 0 && (
        <div className="bonds-display">
          {bonds.map((bond, i) => (
            <div key={i} className="investment-item bond-item">
              <span>📄 Bond (${bond.purchasePrice}): ${getBondCashOutValue(bond)}</span>
              <button className="cashout-btn" onClick={() => cashOutBond(i)}>Cash Out</button>
            </div>
          ))}
        </div>
      )}

      {stockOptions.length > 0 && (
        <div className="stocks-display">
          {stockOptions.map((opt, i) => {
            const handsLeft = 3 - opt.roundsHeld;
            return (
              <div key={i} className="investment-item stock-item">
                <span>
                  📈 Stock (${opt.purchasePrice}):{' '}
                  {opt.roundsHeld >= 3 ? 'Ready!' : `${handsLeft} hand${handsLeft !== 1 ? 's' : ''} left`}
                </span>
                <button
                  className="cashout-btn"
                  onClick={() => cashOutStockOption(i)}
                  disabled={opt.roundsHeld < 3}
                >
                  {opt.roundsHeld >= 3 ? `Cash Out (1/3 → $${opt.purchasePrice * 5})` : 'Waiting...'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
