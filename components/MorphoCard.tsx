import { useState } from "react";
import { formatNumber } from "accounting";
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
import { FaInfinity } from "react-icons/fa";
import { RxReset } from "react-icons/rx";
import { FiAlertTriangle } from "react-icons/fi";
import { Trans } from "@lingui/macro";

import { useMorphoData } from "../hooks/useMorphoData";
import { MorphoPosition } from "../store/morphoDataStore";
import { getHealthFactorColor } from "../hooks/useAaveData";
import TokenIcon from "./TokenIcon";

const CHAIN_ICONS: Record<string, string> = {
  "Ethereum":    "/icons/networks/ethereum.svg",
  "Base":        "/icons/networks/base.svg",
  "Unichain":    "/icons/networks/unichain.svg",
  "Arbitrum One":"/icons/networks/arbitrum.svg",
  "Polygon":     "/icons/networks/polygon.svg",
  "OP Mainnet":  "/icons/networks/optimism.svg",
  "World Chain": "/icons/networks/worldchain.svg",
};

type Props = {
  address: string;
};

export default function MorphoCard({ address }: Props) {
  const { isFetching, fetchError, positions, updatePosition, resetPosition } =
    useMorphoData(address);

  if (isFetching && positions.length === 0) {
    return (
      <Stack mt={10} spacing="sm">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} height={160} radius="md" />
        ))}
      </Stack>
    );
  }

  if (!isFetching && positions.length === 0) {
    return (
      <Center mt={30}>
        <Text color="dimmed" ta="center">
          <Trans>No Morpho positions found for this address.</Trans>
        </Text>
      </Center>
    );
  }

  const borrowPositions = positions.filter((p) => p.borrowTokens > 0);
  const supplyPositions = positions.filter(
    (p) => p.borrowTokens === 0 && p.supplyTokens > 0
  );

  const ethereumPositions = positions.filter((p) => p.chainId === 1);
  const basePositions = positions.filter((p) => p.chainId === 8453);

  const renderChainGroup = (chainPositions: MorphoPosition[], chainName: string) => {
    if (chainPositions.length === 0) return null;
    return (
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
          {chainPositions.map((pos) => (
            <PositionCard
              key={`${pos.chainId}-${pos.marketId}`}
              position={pos}
              onUpdate={(update) =>
                updatePosition(pos.marketId, pos.chainId, update)
              }
              onReset={() => resetPosition(pos.marketId, pos.chainId)}
            />
          ))}
        </Stack>
      </Box>
    );
  };

  return (
    <Box mt={10}>
      {fetchError && (
        <Paper p="xs" mb="sm" style={{ background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.3)" }}>
          <Group spacing={6}>
            <FiAlertTriangle color="#FF5555" />
            <Text size="xs" color="red">
              {fetchError}
            </Text>
          </Group>
        </Paper>
      )}

      {renderChainGroup(ethereumPositions, "Ethereum")}
      {renderChainGroup(basePositions, "Base")}
    </Box>
  );
}

// ───── Single position card ─────────────────────────────────────────────────

type PositionCardProps = {
  position: MorphoPosition;
  onUpdate: (update: Partial<{
    workingCollateralTokens: number;
    workingBorrowTokens: number;
    workingCollateralPriceUsd: number;
    workingLoanPriceUsd: number;
  }>) => void;
  onReset: () => void;
};

function PositionCard({ position, onUpdate, onReset }: PositionCardProps) {
  const isBorrowPosition = position.borrowTokens > 0;
  const isSupplyPosition = !isBorrowPosition && position.supplyTokens > 0;

  const collSymbol = position.collateralAsset?.symbol ?? "—";
  const loanSymbol = position.loanAsset.symbol;

  const hf = position.workingHealthFactor;
  const hfColor = getHealthFactorColor(isFinite(hf) ? hf : 999);

  const hasChanged =
    Math.abs(position.workingCollateralTokens - position.collateralTokens) > 1e-10 ||
    Math.abs(position.workingBorrowTokens - position.borrowTokens) > 1e-10 ||
    Math.abs(position.workingCollateralPriceUsd - (position.collateralAsset?.priceUsd ?? 0)) > 1e-10 ||
    Math.abs(position.workingLoanPriceUsd - (position.loanAsset?.priceUsd ?? 0)) > 1e-10;

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
          {isBorrowPosition && position.collateralAsset && (
            <TokenIcon symbol={collSymbol} size={20} />
          )}
          <TokenIcon symbol={loanSymbol} size={20} />
          <Title order={5} style={{ lineHeight: 1 }}>
            {isBorrowPosition ? `${collSymbol} / ${loanSymbol}` : loanSymbol}
          </Title>
          {isBorrowPosition && (
            <Badge size="xs" color="gray" variant="outline">
              LLTV {formatNumber(position.lltv * 100, 0)}%
            </Badge>
          )}
        </Group>

        <Group spacing={6}>
          {isBorrowPosition && (
            <HFBadge hf={hf} color={hfColor} />
          )}
          {isSupplyPosition && (
            <Badge size="sm" color="teal" variant="light">
              Supply {formatNumber(position.supplyApy * 100, 2)}% APY
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

      {/* Stats row */}
      <Flex gap="xl" wrap="wrap" mb={isBorrowPosition ? 12 : 0}>
        {isBorrowPosition && position.collateralAsset && (
          <Box>
            <Text size="xs" color="dimmed">
              <Trans>Collateral</Trans>
            </Text>
            <Text size="sm" fw={600}>
              {formatNumber(position.workingCollateralTokens, 4)} {collSymbol}
            </Text>
            {position.collateralUsd !== null && (
              <Text size="xs" color="dimmed">
                ≈ ${formatNumber(position.workingCollateralTokens * position.workingCollateralPriceUsd, 2)}
              </Text>
            )}
          </Box>
        )}
        {isBorrowPosition && (
          <Box>
            <Text size="xs" color="dimmed">
              <Trans>Borrow</Trans>
            </Text>
            <Text size="sm" fw={600}>
              {formatNumber(position.workingBorrowTokens, 4)} {loanSymbol}
            </Text>
            {position.borrowUsd !== null && (
              <Text size="xs" color="dimmed">
                ≈ ${formatNumber(position.workingBorrowTokens * position.workingLoanPriceUsd, 2)}
              </Text>
            )}
          </Box>
        )}
        {isBorrowPosition && (
          <Box>
            <Text size="xs" color="dimmed">
              <Trans>Borrow APY</Trans>
            </Text>
            <Text size="sm" fw={600} color="orange">
              {formatNumber(position.borrowApy * 100, 2)}%
            </Text>
          </Box>
        )}
        {isSupplyPosition && (
          <Box>
            <Text size="xs" color="dimmed">
              <Trans>Supplied</Trans>
            </Text>
            <Text size="sm" fw={600}>
              {formatNumber(position.supplyTokens, 4)} {loanSymbol}
            </Text>
            {position.supplyUsd !== null && (
              <Text size="xs" color="dimmed">
                ≈ ${formatNumber(position.supplyUsd, 2)}
              </Text>
            )}
          </Box>
        )}
      </Flex>

      {/* Simulation sliders (only for borrow positions with known prices) */}
      {isBorrowPosition &&
        position.collateralAsset &&
        position.collateralAsset.priceUsd !== null &&
        position.loanAsset.priceUsd !== null && (
          <SimulationSliders
            position={position}
            onUpdate={onUpdate}
          />
        )}

      {/* Unknown price warning */}
      {isBorrowPosition &&
        (position.collateralAsset?.priceUsd === null || position.loanAsset.priceUsd === null) && (
          <Text size="xs" color="dimmed" mt={6}>
            <FiAlertTriangle
              size={11}
              style={{ verticalAlign: "middle", marginRight: 4 }}
            />
            <Trans>Price data unavailable — simulation disabled</Trans>
          </Text>
        )}
    </Paper>
  );
}

// ───── Health factor badge ───────────────────────────────────────────────────

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

// ───── Simulation sliders ────────────────────────────────────────────────────

type SimulationSlidersProps = {
  position: MorphoPosition;
  onUpdate: (update: Partial<{
    workingCollateralTokens: number;
    workingBorrowTokens: number;
    workingCollateralPriceUsd: number;
    workingLoanPriceUsd: number;
  }>) => void;
};

function SimulationSliders({ position, onUpdate }: SimulationSlidersProps) {
  const collSymbol = position.collateralAsset?.symbol ?? "—";
  const loanSymbol = position.loanAsset.symbol;

  const collPrice = position.collateralAsset?.priceUsd ?? 0;
  const loanPrice = position.loanAsset.priceUsd ?? 0;

  const maxCollateral = Math.max(position.collateralTokens * 2, 0.001);
  const maxBorrow = Math.max(position.borrowTokens * 2, 0.001);
  const maxCollPrice = Math.max(collPrice * 2, 0.01);
  const maxLoanPrice = Math.max(loanPrice * 2, 0.01);

  return (
    <Box mt={10}>
      <Divider mb={10} variant="dotted" />

      <Text size="xs" color="dimmed" mb={6} tt="uppercase" fw={600} style={{ letterSpacing: "0.05em" }}>
        <Trans>Simulate</Trans>
      </Text>

      <Stack spacing={8}>
        {/* Collateral amount */}
        <SliderRow
          label={`${collSymbol} amount`}
          value={position.workingCollateralTokens}
          min={0}
          max={maxCollateral}
          step={maxCollateral / 200}
          format={(v) => `${formatNumber(v, 4)} ${collSymbol}`}
          onChange={(v) => onUpdate({ workingCollateralTokens: v })}
        />

        {/* Borrow amount */}
        <SliderRow
          label={`${loanSymbol} borrow`}
          value={position.workingBorrowTokens}
          min={0}
          max={maxBorrow}
          step={maxBorrow / 200}
          format={(v) => `${formatNumber(v, 4)} ${loanSymbol}`}
          onChange={(v) => onUpdate({ workingBorrowTokens: v })}
        />

        {/* Collateral price */}
        <SliderRow
          label={`${collSymbol} price`}
          value={position.workingCollateralPriceUsd}
          min={0}
          max={maxCollPrice}
          step={maxCollPrice / 200}
          format={(v) => `$${formatNumber(v, 2)}`}
          onChange={(v) => onUpdate({ workingCollateralPriceUsd: v })}
        />

        {/* Loan price */}
        <SliderRow
          label={`${loanSymbol} price`}
          value={position.workingLoanPriceUsd}
          min={0.001}
          max={maxLoanPrice}
          step={maxLoanPrice / 200}
          format={(v) => `$${formatNumber(v, 4)}`}
          onChange={(v) => onUpdate({ workingLoanPriceUsd: v })}
        />
      </Stack>
    </Box>
  );
}

// ───── Generic slider row ────────────────────────────────────────────────────

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
          thumb: {
            borderColor: "#00C4FF",
            background: "#00C4FF",
            width: 12,
            height: 12,
          },
          bar: {
            background: "linear-gradient(90deg, #00C4FF, #8B3FE8)",
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
