import { useEffect, useRef, useState } from 'react';

interface FlipGroupProps {
  value: string;
  colorClass: string; // 'rainbow-text' or ''
  colorStyle?: React.CSSProperties;
}

export default function FlipGroup({ value, colorClass, colorStyle }: FlipGroupProps) {
  const [display, setDisplay] = useState(value);
  const [previous, setPrevious] = useState(value);
  const [flipping, setFlipping] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (value !== display) {
      setPrevious(display);
      setDisplay(value);
      setFlipping(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setFlipping(false), 620);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const digitStyle: React.CSSProperties = {
    fontSize: 'var(--flip-font)',
    transform: 'scaleY(1.02) scaleX(0.68)',
    ...colorStyle,
  };

  // Each half crops a full-card-height inner box, so the digit is
  // perfectly centered on the card's midline.
  const renderHalf = (val: string, half: 'top' | 'bottom', extraClass = '') => (
    <div className={`flip-half ${half} ${extraClass}`}>
      <div className={`flip-inner ${half === 'top' ? 'inner-top' : 'inner-bottom'}`}>
        <span className={`flip-digits ${colorClass}`} style={digitStyle}>
          {val}
        </span>
      </div>
    </div>
  );

  return (
    <div
      className="flip-card"
      style={{ width: 'var(--flip-w)', height: 'var(--flip-h)' }}
    >
      {/* static halves */}
      {renderHalf(display, 'top')}
      {renderHalf(flipping ? previous : display, 'bottom')}

      {/* animated flaps */}
      {flipping && (
        <>
          {renderHalf(previous, 'top', 'flap flap-top')}
          {renderHalf(display, 'bottom', 'flap flap-bottom')}
        </>
      )}

      <div className="flip-divider" />
    </div>
  );
}
