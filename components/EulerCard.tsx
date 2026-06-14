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
import { Trans } from "@lingui/macro";

import { useEulerData } from "../hooks/useEulerData";
import { EulerCollateral, EulerPosition } from "../store/eulerDataStore";
import { getHealthFactorColor } from "../hooks/useAaveData";
import TokenIcon from "./TokenIcon";

type Props = { address: string };

export default function EulerCard({ address }: Props) {
  const { isFetching, fetchError, positions, updatePosition, resetPosition } =
    useEulerData(address);

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
          <Trans>No Euler v2 positions found for this address.</Trans>
        </Text>
      </Center>
    );
  }

  return (
    <Stack mt={10} spacing="md">
      {positions.map((pos, posIdx) => (
        <PositionCard
          key={pos.account}
          pos={pos}
          posIdx={posIdx}
          onUpdate={(posUpdate, colUpdates) => updatePosition(posIdx, posUpdate, colUpdates)}
          onReset={() => resetPosition(posIdx)}
        />
      ))}
    </Stack>
  );
}

type PositionCardProps = {
  pos: EulerPosition;
  posIdx: number;
  onUpdate: (
    posUpdate: { workingDebtTokens?: number; workingDebtPriceUsd?: number },
    colUpdates?: Array<{ idx: number; workingTokens?: number; workingPriceUsd?: number }>
  ) => void;
  onReset: () => void;
};

function PositionCard({ pos, posIdx, onUpdate, onReset }: PositionCardProps) {
  const hf = pos.workingHealthFactor;
  const hfColor = hf < 0 ? "gray" : getHealthFactorColor(hf);
  const isModified =
    pos.workingDebtTokens !== pos.debtTokens ||
    pos.workingDebtPriceUsd !== pos.debtPriceUsd ||
    pos.collaterals.some(
      (c) => c.workingTokens !== c.tokens || c.workingPriceUsd !== c.priceUsd
    );

  const subAccountLabel =
    pos.subAccountId === 0 ? "Main account" : `Sub-account ${pos.subAccountId}`;

  return (
    <Paper withBorder p="md" radius="md">
      <Flex justify="space-between" align="center" mb="sm">
        <Group spacing="xs">
          <img src="/icons/tokens/euler.svg" width={20} height={20} alt="Euler" style={{ borderRadius: 4 }} />
          <Title order={5} style={{ margin: 0 }}>
            Euler v2 — {subAccountLabel}
          </Title>
        </Group>
        <Group spacing="xs">
          <Tooltip label={hf < 0 ? "No debt" : `Health Factor: ${hf.toFixed(3)}`} withArrow>
            <Badge color={hfColor} variant="filled" size="lg">
              {hf < 0 ? (
                <FaInfinity />
              ) : (
                hf.toFixed(2)
              )}
            </Badge>
          </Tooltip>
          {isModified && (
            <Tooltip label="Reset to on-chain values" withArrow>
              <Button
                variant="subtle"
                compact
                color="gray"
                onClick={onReset}
                leftIcon={<RxReset />}
              >
                <Trans>Reset</Trans>
              </Button>
            </Tooltip>
          )}
        </Group>
      </Flex>

      {/* Debt summary */}
      <Box mb="sm">
        <Text size="xs" color="dimmed" mb={4}>
          <Trans>Borrow</Trans>
        </Text>
        <Flex justify="space-between" align="center">
          <Group spacing="xs">
            <TokenIcon symbol={pos.debtAssetSymbol} size={18} />
            <Text size="sm" weight={600}>
              {pos.debtAssetSymbol}
            </Text>
            <Text size="sm" color="dimmed">
              via {pos.liabilityVaultSymbol}
            </Text>
          </Group>
          <Text size="sm">
            {formatNumber(pos.workingDebtTokens, { precision: 4 })}{" "}
            <Text size="xs" color="dimmed" span>
              (${formatNumber(pos.workingDebtUsd, { precision: 2 })})
            </Text>
          </Text>
        </Flex>
      </Box>

      {/* Debt simulation sliders */}
      <Box mb="md" px="xs">
        <Text size="xs" color="dimmed" mb={4}>
          Borrow amount ({pos.debtAssetSymbol})
        </Text>
        <Slider
          min={0}
          max={pos.debtTokens * 2 || 1}
          step={pos.debtTokens / 100 || 0.01}
          value={pos.workingDebtTokens}
          onChange={(v) => onUpdate({ workingDebtTokens: v })}
          label={(v) => formatNumber(v, { precision: 4 })}
          size="xs"
        />
        <Text size="xs" color="dimmed" mb={4} mt="xs">
          {pos.debtAssetSymbol} price (USD)
        </Text>
        <Slider
          min={pos.debtPriceUsd * 0.1}
          max={pos.debtPriceUsd * 2}
          step={pos.debtPriceUsd / 100 || 0.01}
          value={pos.workingDebtPriceUsd}
          onChange={(v) => onUpdate({ workingDebtPriceUsd: v })}
          label={(v) => `$${formatNumber(v, { precision: 4 })}`}
          size="xs"
        />
      </Box>

      <Divider mb="sm" label="Collateral" labelPosition="left" />

      {/* Collaterals */}
      {pos.collaterals.length === 0 ? (
        <Text size="sm" color="dimmed">
          <Trans>No collateral enabled.</Trans>
        </Text>
      ) : (
        <Stack spacing="md">
          {pos.collaterals.map((col, colIdx) => (
            <CollateralRow
              key={col.vaultAddress}
              col={col}
              colIdx={colIdx}
              onUpdate={(upd) => onUpdate({}, [{ idx: colIdx, ...upd }])}
            />
          ))}
        </Stack>
      )}
    </Paper>
  );
}

type CollateralRowProps = {
  col: EulerCollateral;
  colIdx: number;
  onUpdate: (upd: { workingTokens?: number; workingPriceUsd?: number }) => void;
};

function CollateralRow({ col, onUpdate }: CollateralRowProps) {
  return (
    <Box>
      <Flex justify="space-between" align="center" mb={4}>
        <Group spacing="xs">
          <TokenIcon symbol={col.assetSymbol} size={16} />
          <Text size="sm" weight={600}>
            {col.assetSymbol}
          </Text>
          <Text size="xs" color="dimmed">
            via {col.vaultSymbol}
          </Text>
          <Badge size="xs" variant="outline" color="blue">
            LT {(col.liquidationLTV * 100).toFixed(0)}%
          </Badge>
        </Group>
        <Text size="sm">
          {formatNumber(col.workingTokens, { precision: 4 })}{" "}
          <Text size="xs" color="dimmed" span>
            (${formatNumber(col.workingTokens * col.workingPriceUsd, { precision: 2 })})
          </Text>
        </Text>
      </Flex>
      <Box px="xs">
        <Text size="xs" color="dimmed" mb={4}>
          {col.assetSymbol} balance
        </Text>
        <Slider
          min={0}
          max={col.tokens * 2 || 1}
          step={col.tokens / 100 || 0.01}
          value={col.workingTokens}
          onChange={(v) => onUpdate({ workingTokens: v })}
          label={(v) => formatNumber(v, { precision: 4 })}
          size="xs"
        />
        <Text size="xs" color="dimmed" mb={4} mt="xs">
          {col.assetSymbol} price (USD)
        </Text>
        <Slider
          min={col.priceUsd * 0.1}
          max={col.priceUsd * 2}
          step={col.priceUsd / 100 || 0.01}
          value={col.workingPriceUsd}
          onChange={(v) => onUpdate({ workingPriceUsd: v })}
          label={(v) => `$${formatNumber(v, { precision: 4 })}`}
          size="xs"
        />
      </Box>
    </Box>
  );
}
