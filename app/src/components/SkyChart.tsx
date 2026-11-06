/**
 * Sky chart polar (RF-05).
 *
 * Proyección azimutal equidistante del hemisferio visible:
 *   centro = cenit (90°), borde = horizonte (0°)
 *   r = R · (90° − elevación) / 90°
 *   x = cx + r · sin(az),  y = cy − r · cos(az)
 *
 * Norte arriba y Este a la DERECHA (convención de gpredict): coincide con lo
 * que ve el usuario al sostener el teléfono horizontal apuntando al Norte,
 * por eso el mismo componente sirve rotado como dial de la brújula.
 *
 * La trayectoria se colorea según iluminación: ámbar = el satélite refleja
 * luz solar (potencialmente visible), azul tenue = en la sombra terrestre.
 */
import { memo } from 'react';
import Svg, { Circle, G, Line, Polyline, Text as SvgText } from 'react-native-svg';
import type { SkySample } from '../core/types';
import { colors } from '../theme';

interface Props {
  size: number;
  samples: SkySample[];
  /** Posición actual del satélite (si está sobre el horizonte). */
  current?: { azimuth: number; elevation: number } | null;
  minElevation?: number;
  /** Rotación del gráfico (grados) — la brújula lo gira según el rumbo del teléfono. */
  rotation?: number;
  showLabels?: boolean;
}

export function polarToXY(az: number, el: number, R: number, c: number) {
  const r = (R * (90 - Math.max(-5, el))) / 90;
  const a = (az * Math.PI) / 180;
  return { x: c + r * Math.sin(a), y: c - r * Math.cos(a) };
}

function SkyChartImpl({ size, samples, current, minElevation = 0, rotation = 0, showLabels = true }: Props) {
  const pad = showLabels ? 22 : 6;
  const c = size / 2;
  const R = c - pad;

  // Segmentos contiguos con el mismo estado de iluminación.
  const segments: { sunlit: boolean; pts: string }[] = [];
  let cur: { sunlit: boolean; pts: string[] } | null = null;
  for (const s of samples) {
    const { x, y } = polarToXY(s.azimuth, s.elevation, R, c);
    const pt = `${x.toFixed(1)},${y.toFixed(1)}`;
    if (!cur || cur.sunlit !== s.sunlit) {
      if (cur) {
        cur.pts.push(pt); // continuidad visual entre segmentos
        segments.push({ sunlit: cur.sunlit, pts: cur.pts.join(' ') });
      }
      cur = { sunlit: s.sunlit, pts: [pt] };
    } else {
      cur.pts.push(pt);
    }
  }
  if (cur) segments.push({ sunlit: cur.sunlit, pts: cur.pts.join(' ') });

  const first = samples[0];
  const last = samples[samples.length - 1];
  const maxS = samples.reduce<SkySample | null>((m, s) => (!m || s.elevation > m.elevation ? s : m), null);

  const cardinal: [string, number][] = [
    ['N', 0],
    ['E', 90],
    ['S', 180],
    ['O', 270],
  ];

  return (
    <Svg width={size} height={size} accessibilityLabel="Gráfico polar del pase">
      <G rotation={rotation} origin={`${c}, ${c}`}>
        {/* Anillos de elevación 0°, 30°, 60° */}
        {[0, 30, 60].map((el) => (
          <Circle key={el} cx={c} cy={c} r={(R * (90 - el)) / 90} stroke={colors.border} strokeWidth={el === 0 ? 1.5 : 1} fill="none" />
        ))}
        {/* Umbral de elevación mínima del enlace */}
        {minElevation > 0 && (
          <Circle cx={c} cy={c} r={(R * (90 - minElevation)) / 90} stroke={colors.amber} strokeOpacity={0.35} strokeDasharray="4,4" fill="none" />
        )}
        <Line x1={c} y1={c - R} x2={c} y2={c + R} stroke={colors.border} strokeWidth={1} />
        <Line x1={c - R} y1={c} x2={c + R} y2={c} stroke={colors.border} strokeWidth={1} />
        {showLabels &&
          [30, 60].map((el) => (
            <SvgText key={el} x={c + 3} y={c - (R * (90 - el)) / 90 + 11} fill={colors.textDim} fontSize={9}>
              {el}°
            </SvgText>
          ))}
        {showLabels &&
          cardinal.map(([label, az]) => {
            const { x, y } = polarToXY(az, -12, R, c);
            return (
              <SvgText
                key={label}
                x={x}
                y={y + 4}
                fill={label === 'N' ? colors.red : colors.textDim}
                fontSize={12}
                fontWeight="700"
                textAnchor="middle"
                rotation={-rotation}
                origin={`${x}, ${y}`}
              >
                {label}
              </SvgText>
            );
          })}

        {/* Trayectoria del pase */}
        {segments.map((s, i) => (
          <Polyline
            key={i}
            points={s.pts}
            fill="none"
            stroke={s.sunlit ? colors.amber : colors.accent}
            strokeOpacity={s.sunlit ? 1 : 0.55}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {first && (() => {
          const p = polarToXY(first.azimuth, first.elevation, R, c);
          return <Circle cx={p.x} cy={p.y} r={5} fill={colors.green} />;
        })()}
        {last && (() => {
          const p = polarToXY(last.azimuth, last.elevation, R, c);
          return <Circle cx={p.x} cy={p.y} r={5} fill={colors.red} />;
        })()}
        {maxS && (() => {
          const p = polarToXY(maxS.azimuth, maxS.elevation, R, c);
          return <Circle cx={p.x} cy={p.y} r={4} fill={colors.text} />;
        })()}
        {current && current.elevation > -5 && (() => {
          const p = polarToXY(current.azimuth, current.elevation, R, c);
          return (
            <G>
              <Circle cx={p.x} cy={p.y} r={11} fill={colors.accent} fillOpacity={0.25} />
              <Circle cx={p.x} cy={p.y} r={6} fill={colors.accent} stroke={colors.bg} strokeWidth={2} />
            </G>
          );
        })()}
      </G>
    </Svg>
  );
}

export const SkyChart = memo(SkyChartImpl);
