interface SparklineProps {
	values: number[];
	width?: number;
	height?: number;
	className?: string;
	/** Stroke colour; defaults to the current text colour. */
	color?: string;
}

/**
 * A tiny dependency-free WPM trend line for the parent dashboard. Values are
 * oldest -> newest; the curve is normalised to its own min/max so improvement
 * is visible even within a narrow band.
 */
export default function Sparkline({
	values,
	width = 120,
	height = 28,
	className,
	color = "currentColor",
}: SparklineProps) {
	if (values.length === 0) {
		return <span className="text-xs text-stone-300">—</span>;
	}

	const pad = 3;
	const innerW = width - pad * 2;
	const innerH = height - pad * 2;
	const min = Math.min(...values);
	const max = Math.max(...values);
	const span = max - min;

	const x = (i: number) =>
		values.length === 1 ? width / 2 : pad + (i / (values.length - 1)) * innerW;
	// Flat band (span 0) sits on the mid-line; otherwise newer-higher reads up.
	const y = (v: number) =>
		span === 0 ? pad + innerH / 2 : pad + innerH - ((v - min) / span) * innerH;

	const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
	const lastIdx = values.length - 1;
	const lastValue = values[lastIdx] ?? min;

	return (
		<svg
			width={width}
			height={height}
			viewBox={`0 0 ${width} ${height}`}
			className={className}
			role="img"
			aria-label={`WPM trend across ${values.length} session${
				values.length === 1 ? "" : "s"
			}`}
		>
			{values.length > 1 && (
				<polyline
					points={points}
					fill="none"
					stroke={color}
					strokeWidth={2}
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			)}
			<circle cx={x(lastIdx)} cy={y(lastValue)} r={2.5} fill={color} />
		</svg>
	);
}
