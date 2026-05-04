import React, { useEffect, useState } from 'react';

interface TurnTimerProps {
  deadline: number | null; // UTC ms
  totalSeconds: number;
  compact?: boolean; // Smaller ring for player-seat usage
}

export const TurnTimer: React.FC<TurnTimerProps> = ({ deadline, totalSeconds, compact = false }) => {
  const [remaining, setRemaining] = useState<number>(totalSeconds);

  useEffect(() => {
    if (deadline === null) return;

    const tick = () => {
      const secs = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(secs);
    };

    tick(); // Immediate tick
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline]);

  if (deadline === null) return null;

  const fraction = totalSeconds > 0 ? remaining / totalSeconds : 0;
  const isUrgent = remaining <= 5;

  const size = compact ? 36 : 56;
  const stroke = compact ? 3 : 4;
  const radius = (size - stroke * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - fraction);

  return (
    <div
      className={`turn-timer ${isUrgent ? 'turn-timer--urgent' : ''} ${compact ? 'turn-timer--compact' : ''}`}
      aria-label={`${remaining} seconds remaining`}
    >
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        {/* Background ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.15)"
          strokeWidth={stroke}
        />
        {/* Progress ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={isUrgent ? '#ef4444' : '#22c55e'}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.25s linear, stroke 0.5s' }}
        />
      </svg>
      <span className="turn-timer__digits">{remaining}</span>
    </div>
  );
};
