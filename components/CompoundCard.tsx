import {
  Badge,
  Box,
  Button,
  Center,
  Divider,
  Flex,
  Group,
  Paper,
  Skeleton,
  Slider,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { formatNumber } from "accounting";
import { FaInfinity } from "react-icons/fa";
import { RxReset } from "react-icons/rx";
import { FiAlertTriangle } from "react-icons/fi";
import { Trans } from "@lingui/macro";

import { useCompoundData } from "../hooks/useCompoundData";
import { CompoundCollateral, CompoundPosition } from "../store/compoundDataStore";
import { getHealthFactorColor } from "../hooks/useAaveData";
import TokenIcon from "./TokenIcon";

type Props = { address: string };

export default function CompoundCard({ address }: Props) {
  const { isFetching, fetchError, positions, updatePosition, resetPosition } =
    useCompoundData(address);

  if (isFetching && positions.length === 0) {
    return (
      <Stack mt={10} spacing="sm">
        {[1, 2].map((i) => (
          <Skeleton key={i} height={160} radius="md" />
        ))}
      </Stack>
    );
  }

  if (!isFetching && positions.length === 0) {
    return (
      <Center mt={30}>
        <Text color="dimmed" ta="center">
          <Trans>No Compound v3 positions found for this address.</Trans>
        </Text>
      </Center>
    );
  }

  // Group positions by chain
  const chains = Array.from(new Set(positions.map((p) => p.chainName)));

  const chainIcon: Record<string, string> = {
    Ethereum: "/icons/networks/ethereum.svg",
    Base: "/icons/networks/base.svg",
    Arbitrum: "/icons/networks/arbitrum.svg",
    Optimism: "/icons/networks/optimism.svg",
  };

  return (
    <Box mt={10}>
      {fetchError && (
        <Paper
          p="xs"
          mb="sm"
          style={{
            background: "rgba(255,80,80,0.1)",
            border: "1px solid rgba(255,80,80,0.3)",
          }}
        >
          <Group spacing={6}>
            <FiAlertTriangle color="#FF5555" />
            <Text size="xs" color="red">
              {fetchError}
            </Text>
          </Group>
        </Paper>
      )}

      {chains.map((chainName) => {
        const chainPositions = positions.filter((p) => p.chainName === chainName);
        return (
          <Box key={chainName}>
            <Divider
              my="sm"
              label={
                <Group spacing={6}>
                  <img
                    src={chainIcon[chainName] ?? ""}
                    width={16}
                    height={16}
                    alt={chainName}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                  <Text size="sm" fw={600} color="dimmed">
                    {chainName}
                  </Text>
                </Group>
              }
              labelPosition="left"
            />
            <Stack spacing="sm">
              {chainPositions.map((pos) => (
                <PositionCard
                  key={pos.marketId}
                  position={pos}
                  onUpdate={(posUpd, collUpd) =>
                    updatePosition(pos.marketId, posUpd, collUpd)
                  }
                  onReset={() => resetPosition(pos.marketId)}
                />
              ))}
            </Stack>
          </Box>
        );
      })}
    </Box>
  );
}

// ── Single position card ─────────────────────────────────────────────────────

type PositionCardProps = {
  position: CompoundPosition;
  onUpdate: (
    posUpdate: Partial<{ workingBorrowTokens: number; workingBasePriceUsd: number }>,
    collateralUpdates?: { asset: string; workingBalanceTokens?: number; workingPriceUsd?: number }[]
  ) => void;
  onReset: () => void;
};

function PositionCard({ position, onUpdate, onReset }: PositionCardProps) {
  const isBorrowPosition = position.borrowTokens > 0;
  const hf = position.workingHealthFactor;
  const hfColor = getHealthFactorColor(isFinite(hf) ? hf : 999);

  const totalCollateralUsd = position.collaterals.reduce(
    (s, c) => s + c.workingBalanceTokens * c.workingPriceUsd,
    0
  );

  const hasChanged =
    Math.abs(position.workingBorrowTokens - position.borrowTokens) > 1e-10 ||
    Math.abs(position.workingBasePriceUsd - position.basePriceUsd) > 1e-10 ||
    position.collaterals.some(
      (c) =>
        Math.abs(c.workingBalanceTokens - c.balanceTokens) > 1e-10 ||
        Math.abs(c.workingPriceUsd - c.priceUsd) > 1e-10
    );

  return (
    <Paper
      p="md"
      radius="md"
      style={{
        border: "1px solid rgba(0, 196, 255, 0.12)",
        background: "rgba(13, 17, 23, 0.7)",
      }}
    >
      {/* Header */}
      <Flex justify="space-between" align="center" mb={12}>
        <Group spacing={8}>
          <TokenIcon symbol={position.baseSymbol} size={22} />
          <Title order={5} style={{ lineHeight: 1 }}>
            {position.baseSymbol} Market
          </Title>
          <Badge size="xs" color="blue" variant="outline">
            Compound v3
          </Badge>
        </Group>

        <Group spacing={6}>
          {isBorrowPosition && <HFBadge hf={hf} color={hfColor} />}
          {!isBorrowPosition && (
            <Badge size="sm" color="teal" variant="light">
              Supply only
            </Badge>
          )}
          {hasChanged && (
            <Tooltip label="Reset to original values" withArrow>
              <Button
                size="xs"
                variant="subtle"
                compact
                color="gray"
                leftIcon={<RxReset size={12} />}
                onClick={onReset}
              >
                <Trans>Reset</Trans>
              </Button>
            </Tooltip>
          )}
        </Group>
      </Flex>

      {/* Stats */}
      <Flex gap="xl" wrap="wrap" mb={isBorrowPosition ? 12 : 0}>
        {isBorrowPosition && position.collaterals.length > 0 && (
          <Box>
            <Text size="xs" color="dimmed">
              <Trans>Collateral</Trans>
            </Text>
            <Text size="sm" fw={600}>
              ${formatNumber(totalCollateralUsd, 2)}
            </Text>
            <Text size="xs" color="dimmed">
              {position.collaterals.map((c) => c.symbol).join(", ")}
            </Text>
          </Box>
        )}
        {isBorrowPosition && (
          <Box>
            <Text size="xs" color="dimmed">
              <Trans>Borrow</Trans>
            </Text>
            <Text size="sm" fw={600}>
              {formatNumber(position.workingBorrowTokens, 4)} {position.baseSymbol}
            </Text>
            <Text size="xs" color="dimmed">
              ≈ ${formatNumber(position.workingBorrowTokens * position.workingBasePriceUsd, 2)}
            </Text>
          </Box>
        )}
        {!isBorrowPosition && (
          <Box>
            <Text size="xs" color="dimmed">
              <Trans>Supplied</Trans>
            </Text>
            <Text size="sm" fw={600}>
              {formatNumber(position.supplyTokens, 4)} {position.baseSymbol}
            </Text>
            <Text size="xs" color="dimmed">
              ≈ ${formatNumber(position.supplyUsd, 2)}
            </Text>
          </Box>
        )}
      </Flex>

      {/* Collateral breakdown */}
      {isBorrowPosition && position.collaterals.length > 0 && (
        <Box mb={10}>
          <Divider mb={8} variant="dotted" />
          <Stack spacing={4}>
            {position.collaterals.map((c) => (
              <Flex key={c.asset} justify="space-between" align="center">
                <Group spacing={6}>
                  <TokenIcon symbol={c.symbol} size={14} />
                  <Text size="xs" color="dimmed">
                    {c.symbol}
                  </Text>
                  <Badge size="xs" variant="outline" color="gray">
                    LT {formatNumber(c.liquidateCollateralFactor * 100, 0)}%
                  </Badge>
                </Group>
                <Text size="xs" fw={500}>
                  {formatNumber(c.workingBalanceTokens, 4)} (${formatNumber(c.workingBalanceTokens * c.workingPriceUsd, 0)})
                </Text>
              </Flex>
            ))}
          </Stack>
        </Box>
      )}

      {/* Simulation sliders */}
      {isBorrowPosition && (
        <SimulationSliders
          position={position}
          onUpdate={onUpdate}
        />
      )}
    </Paper>
  );
}

// ── HF badge ─────────────────────────────────────────────────────────────────

function HFBadge({ hf, color }: { hf: number; color: string }) {
  return (
    <Badge size="sm" color={color} variant="filled">
      <Group spacing={3} style={{ flexWrap: "nowrap" }}>
        <Text size="xs">HF</Text>
        {!isFinite(hf) || isNaN(hf) ? (
          <FaInfinity size={11} />
        ) : (
          <Text size="xs">{formatNumber(hf, 2)}</Text>
        )}
      </Group>
    </Badge>
  );
}

// ── Simulation sliders ────────────────────────────────────────────────────────

type SimulationSlidersProps = {
  position: CompoundPosition;
  onUpdate: (
    posUpdate: Partial<{ workingBorrowTokens: number; workingBasePriceUsd: number }>,
    collateralUpdates?: { asset: string; workingBalanceTokens?: number; workingPriceUsd?: number }[]
  ) => void;
};

function SimulationSliders({ position, onUpdate }: SimulationSlidersProps) {
  const maxBorrow = Math.max(position.borrowTokens * 2, 0.001);
  const maxBasePrice = Math.max(position.basePriceUsd * 2, 0.01);

  return (
    <Box mt={4}>
      <Divider mb={10} variant="dotted" />
      <Text
        size="xs"
        color="dimmed"
        mb={8}
        tt="uppercase"
        fw={600}
        style={{ letterSpacing: "0.05em" }}
      >
        <Trans>Simulate</Trans>
      </Text>

      <Stack spacing={8}>
        {/* Borrow amount */}
        <SliderRow
          label={`Borrow (${position.baseSymbol})`}
          value={position.workingBorrowTokens}
          min={0}
          max={maxBorrow}
          step={maxBorrow / 200}
          format={(v) => `${formatNumber(v, 4)} ${position.baseSymbol}`}
          onChange={(v) => onUpdate({ workingBorrowTokens: v })}
        />

        {/* Base price (useful for WETH market; for stablecoins stays near $1) */}
        <SliderRow
          label={`${position.baseSymbol} price`}
          value={position.workingBasePriceUsd}
          min={Math.max(position.basePriceUsd * 0.01, 0.001)}
          max={maxBasePrice}
          step={maxBasePrice / 200}
          format={(v) => `$${formatNumber(v, 4)}`}
          onChange={(v) => onUpdate({ workingBasePriceUsd: v })}
        />

        {/* Per-collateral sliders */}
        {position.collaterals.map((c) => {
          const maxBal = Math.max(c.balanceTokens * 2, 0.001);
          const maxPrice = Math.max(c.priceUsd * 2, 0.01);
          return (
            <Box key={c.asset}>
              <SliderRow
                label={`${c.symbol} amount`}
                value={c.workingBalanceTokens}
                min={0}
                max={maxBal}
                step={maxBal / 200}
                format={(v) => `${formatNumber(v, 4)} ${c.symbol}`}
                onChange={(v) =>
                  onUpdate({}, [{ asset: c.asset, workingBalanceTokens: v }])
                }
              />
              <SliderRow
                label={`${c.symbol} price`}
                value={c.workingPriceUsd}
                min={Math.max(c.priceUsd * 0.01, 0.01)}
                max={maxPrice}
                step={maxPrice / 200}
                format={(v) => `$${formatNumber(v, 2)}`}
                onChange={(v) =>
                  onUpdate({}, [{ asset: c.asset, workingPriceUsd: v }])
                }
              />
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}

// ── Generic slider row ────────────────────────────────────────────────────────

type SliderRowProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
};

function SliderRow({ label, value, min, max, step, format, onChange }: SliderRowProps) {
  return (
    <Box>
      <Flex justify="space-between" mb={2}>
        <Text size="xs" color="dimmed">
          {label}
        </Text>
        <Text size="xs" fw={600} style={{ color: "#00C4FF" }}>
          {format(value)}
        </Text>
      </Flex>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={onChange}
        size="xs"
        radius="xl"
        styles={{
          thumb: { borderColor: "#00C4FF", background: "#00C4FF", width: 12, height: 12 },
          bar: { background: "linear-gradient(90deg, #00C4FF, #8B3FE8)" },
          track: { background: "rgba(255,255,255,0.1)" },
        }}
        label={null}
      />
    </Box>
  );
}
