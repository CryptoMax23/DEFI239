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

import { useFluidData, computeFluidHF } from "../hooks/useFluidData";
import { FluidPosition } from "../store/fluidDataStore";
import { getHealthFactorColor } from "../hooks/useAaveData";
import TokenIcon from "./TokenIcon";

const CHAIN_ICONS: Record<string, string> = {
  "Ethereum":     "/icons/networks/ethereum.svg",
  "Arbitrum One": "/icons/networks/arbitrum.svg",
  "Base":         "/icons/networks/base.svg",
};

type Props = { address: string };

export default function FluidCard({ address }: Props) {
  const { isFetching, fetchError, positions, updatePosition, resetPosition } =
    useFluidData(address);

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
          <Trans>No Fluid positions found for this address.</Trans>
        </Text>
      </Center>
    );
  }

  const chainGroups = positions.reduce<Record<string, FluidPosition[]>>(
    (acc, p) => {
      if (!acc[p.chainName]) acc[p.chainName] = [];
      acc[p.chainName].push(p);
      return acc;
    },
    {}
  );

  const sortedChains = Object.keys(chainGroups).sort((a, b) => {
    if (a === "Ethereum") return -1;
    if (b === "Ethereum") return 1;
    return a.localeCompare(b);
  });

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

      {sortedChains.map((chainName) => (
        <Box key={chainName}>
          <Divider
            my="sm"
            label={
              <Group spacing={6}>
                <img
                  src={CHAIN_ICONS[chainName] ?? "/icons/networks/ethereum.svg"}
                  width={16}
                  height={16}
                  alt={chainName}
                />
                <Text size="sm" fw={600} color="dimmed">
                  {chainName}
                </Text>
              </Group>
            }
            labelPosition="left"
          />
          <Stack spacing="sm">
            {chainGroups[chainName].map((pos) => (
              <PositionCard
                key={`${pos.chainId}-${pos.id}-${pos.positionType}`}
                position={pos}
                onUpdate={(update) => updatePosition(pos.id, pos.chainId, update)}
                onReset={() => resetPosition(pos.id, pos.chainId)}
              />
            ))}
          </Stack>
        </Box>
      ))}
    </Box>
  );
}

// ── Single position card ──────────────────────────────────────────────────────

type PositionCardProps = {
  position: FluidPosition;
  onUpdate: (update: Partial<{
    workingSupplyTokens: number;
    workingBorrowTokens: number;
    workingSupplyPriceUsd: number;
    workingBorrowPriceUsd: number;
  }>) => void;
  onReset: () => void;
};

function PositionCard({ position, onUpdate, onReset }: PositionCardProps) {
  const isVault = position.positionType === "vault";
  const isLending = position.positionType === "lending";

  const colSymbol = position.supplyAsset?.symbol ?? "?";
  const debtSymbol = position.borrowAsset?.symbol ?? "?";
  const lendingSymbol = position.lendingAsset?.symbol ?? "?";

  const hf = position.workingHealthFactor;
  const hfColor = getHealthFactorColor(isFinite(hf) ? hf : 999);

  const hasBorrow = isVault && position.workingBorrowTokens > 0;

  const hasChanged =
    isVault &&
    (Math.abs(position.workingSupplyTokens - position.supplyTokens) > 1e-10 ||
      Math.abs(position.workingBorrowTokens - position.borrowTokens) > 1e-10 ||
      Math.abs(position.workingSupplyPriceUsd - (position.supplyAsset?.priceUsd ?? 0)) > 1e-10 ||
      Math.abs(position.workingBorrowPriceUsd - (position.borrowAsset?.priceUsd ?? 0)) > 1e-10);

  const canSimulate =
    isVault &&
    hasBorrow &&
    position.supplyAsset?.priceUsd !== null &&
    position.borrowAsset?.priceUsd !== null;

  return (
    <Paper
      p="md"
      radius="md"
      style={{
        border: "1px solid rgba(44, 94, 232, 0.2)",
        background: "rgba(13, 17, 23, 0.7)",
      }}
    >
      {/* Header */}
      <Flex justify="space-between" align="center" mb={12}>
        <Group spacing={8}>
          {isVault && (
            <>
              <TokenIcon symbol={colSymbol} size={20} />
              {hasBorrow && <TokenIcon symbol={debtSymbol} size={20} />}
              <Title order={5} style={{ lineHeight: 1 }}>
                {hasBorrow ? `${colSymbol} / ${debtSymbol}` : colSymbol}
              </Title>
            </>
          )}
          {isLending && (
            <>
              <TokenIcon symbol={lendingSymbol} size={20} />
              <Title order={5} style={{ lineHeight: 1 }}>
                {lendingSymbol}
              </Title>
            </>
          )}
          <Badge size="xs" color="blue" variant="outline">
            Fluid
          </Badge>
          {isVault && (
            <Badge size="xs" color="indigo" variant="outline">
              Vault
            </Badge>
          )}
          {isLending && (
            <Badge size="xs" color="teal" variant="outline">
              fToken
            </Badge>
          )}
        </Group>

        <Group spacing={6}>
          {hasBorrow && <HFBadge hf={hf} color={hfColor} />}
          {(isLending || (!hasBorrow && isVault)) && (
            <Badge size="sm" color="teal" variant="light">
              {formatNumber(position.supplyApy * 100, 2)}% APY
            </Badge>
          )}
          {hasBorrow && (
            <Badge size="sm" color="teal" variant="light">
              {formatNumber(position.supplyApy * 100, 2)}% / -{formatNumber(position.borrowApy * 100, 2)}%
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
      <Flex gap="xl" wrap="wrap" mb={canSimulate ? 12 : 0}>
        {isLending && (
          <Box>
            <Text size="xs" color="dimmed">
              <Trans>Supplied</Trans>
            </Text>
            <Text size="sm" fw={600}>
              {formatNumber(position.lendingTokens, 4)} {lendingSymbol}
            </Text>
            {position.lendingUsd !== null && (
              <Text size="xs" color="dimmed">
                ≈ ${formatNumber(position.lendingUsd, 2)}
              </Text>
            )}
          </Box>
        )}

        {isVault && (
          <Box>
            <Text size="xs" color="dimmed">
              <Trans>Collateral</Trans>
            </Text>
            <Text size="sm" fw={600}>
              {formatNumber(position.workingSupplyTokens, 4)} {colSymbol}
            </Text>
            {position.supplyUsd !== null && (
              <Text size="xs" color="dimmed">
                ≈ ${formatNumber(position.workingSupplyTokens * position.workingSupplyPriceUsd, 2)}
              </Text>
            )}
          </Box>
        )}

        {hasBorrow && (
          <Box>
            <Text size="xs" color="dimmed">
              <Trans>Borrow</Trans>
            </Text>
            <Text size="sm" fw={600}>
              {formatNumber(position.workingBorrowTokens, 4)} {debtSymbol}
            </Text>
            {position.borrowUsd !== null && (
              <Text size="xs" color="dimmed">
                ≈ ${formatNumber(position.workingBorrowTokens * position.workingBorrowPriceUsd, 2)}
              </Text>
            )}
          </Box>
        )}

        {isVault && (
          <Box>
            <Text size="xs" color="dimmed">
              <Trans>Liq. Threshold</Trans>
            </Text>
            <Text size="sm" fw={600}>
              {formatNumber(position.liquidationThreshold * 100, 1)}%
            </Text>
          </Box>
        )}
      </Flex>

      {/* Simulation sliders */}
      {canSimulate && (
        <SimulationSliders position={position} onUpdate={onUpdate} />
      )}

      {isVault && hasBorrow &&
        (position.supplyAsset?.priceUsd === null || position.borrowAsset?.priceUsd === null) && (
          <Text size="xs" color="dimmed" mt={6}>
            <FiAlertTriangle size={11} style={{ verticalAlign: "middle", marginRight: 4 }} />
            <Trans>Price data unavailable — simulation disabled</Trans>
          </Text>
        )}
    </Paper>
  );
}

// ── HF Badge ─────────────────────────────────────────────────────────────────

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
  position: FluidPosition;
  onUpdate: (update: Partial<{
    workingSupplyTokens: number;
    workingBorrowTokens: number;
    workingSupplyPriceUsd: number;
    workingBorrowPriceUsd: number;
  }>) => void;
};

function SimulationSliders({ position, onUpdate }: SimulationSlidersProps) {
  const colSymbol = position.supplyAsset?.symbol ?? "?";
  const debtSymbol = position.borrowAsset?.symbol ?? "?";
  const colPrice = position.supplyAsset?.priceUsd ?? 0;
  const debtPrice = position.borrowAsset?.priceUsd ?? 0;

  const maxCol = Math.max(position.supplyTokens * 2, 0.001);
  const maxDebt = Math.max(position.borrowTokens * 2, 0.001);
  const maxColPrice = Math.max(colPrice * 2, 0.01);
  const maxDebtPrice = Math.max(debtPrice * 2, 0.01);

  return (
    <Box mt={10}>
      <Divider mb={10} variant="dotted" />
      <Text size="xs" color="dimmed" mb={6} tt="uppercase" fw={600} style={{ letterSpacing: "0.05em" }}>
        <Trans>Simulate</Trans>
      </Text>
      <Stack spacing={8}>
        <SliderRow
          label={`${colSymbol} amount`}
          value={position.workingSupplyTokens}
          min={0}
          max={maxCol}
          step={maxCol / 200}
          format={(v) => `${formatNumber(v, 4)} ${colSymbol}`}
          onChange={(v) => onUpdate({ workingSupplyTokens: v })}
        />
        <SliderRow
          label={`${debtSymbol} borrow`}
          value={position.workingBorrowTokens}
          min={0}
          max={maxDebt}
          step={maxDebt / 200}
          format={(v) => `${formatNumber(v, 4)} ${debtSymbol}`}
          onChange={(v) => onUpdate({ workingBorrowTokens: v })}
        />
        <SliderRow
          label={`${colSymbol} price`}
          value={position.workingSupplyPriceUsd}
          min={0}
          max={maxColPrice}
          step={maxColPrice / 200}
          format={(v) => `$${formatNumber(v, 2)}`}
          onChange={(v) => onUpdate({ workingSupplyPriceUsd: v })}
        />
        <SliderRow
          label={`${debtSymbol} price`}
          value={position.workingBorrowPriceUsd}
          min={0.001}
          max={maxDebtPrice}
          step={maxDebtPrice / 200}
          format={(v) => `$${formatNumber(v, 4)}`}
          onChange={(v) => onUpdate({ workingBorrowPriceUsd: v })}
        />
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
        <Text size="xs" fw={600} style={{ color: "#2C5EE8" }}>
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
          thumb: {
            borderColor: "#2C5EE8",
            background: "#2C5EE8",
            width: 12,
            height: 12,
          },
          bar: {
            background: "linear-gradient(90deg, #2C5EE8, #7B3FE4)",
          },
          track: {
            background: "rgba(255,255,255,0.1)",
          },
        }}
        label={null}
      />
    </Box>
  );
}
