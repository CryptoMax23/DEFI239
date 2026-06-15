import { Box, Stack, Text, Tooltip, UnstyledButton, createStyles } from "@mantine/core";

export type Protocol = "aave" | "morpho" | "compound" | "spark" | "euler" | "fluid";

type Props = {
  selected: Protocol;
  onSelect: (p: Protocol) => void;
};

const useStyles = createStyles((theme) => ({
  sidebar: {
    width: 72,
    minWidth: 72,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    paddingTop: 4,
  },
  item: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    padding: "10px 6px",
    borderRadius: theme.radius.md,
    cursor: "pointer",
    border: "1px solid transparent",
    transition: "all 120ms ease",
    "&:hover": {
      background: "rgba(0, 196, 255, 0.07)",
      border: "1px solid rgba(0, 196, 255, 0.18)",
    },
  },
  itemActive: {
    background: "rgba(0, 196, 255, 0.12)",
    border: "1px solid rgba(0, 196, 255, 0.35)",
  },
  label: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: theme.colors.dark[2],
    lineHeight: 1,
  },
  labelActive: {
    color: "#00C4FF",
  },
}));

const PROTOCOLS: { id: Protocol; label: string; icon: string }[] = [
  {
    id: "aave",
    label: "Aave",
    icon: "/icons/tokens/aave.svg",
  },
  {
    id: "morpho",
    label: "Morpho",
    icon: "/icons/morpho.svg",
  },
  {
    id: "compound",
    label: "Compound",
    icon: "/icons/tokens/comp.svg",
  },
  {
    id: "spark",
    label: "Spark",
    icon: "/icons/tokens/spark.svg",
  },
  {
    id: "euler",
    label: "Euler",
    icon: "/icons/tokens/euler.svg",
  },
  {
    id: "fluid",
    label: "Fluid",
    icon: "/icons/fluid.svg",
  },
];

export default function ProtocolSidebar({ selected, onSelect }: Props) {
  const { classes, cx } = useStyles();

  return (
    <Box className={classes.sidebar}>
      {PROTOCOLS.map((proto) => (
        <Tooltip key={proto.id} label={proto.label} position="right" withArrow>
          <UnstyledButton
            className={cx(classes.item, {
              [classes.itemActive]: selected === proto.id,
            })}
            onClick={() => onSelect(proto.id)}
          >
            <img
              src={proto.icon}
              width={28}
              height={28}
              alt={proto.label}
              style={{ borderRadius: 6 }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
            <Text
              className={cx(classes.label, {
                [classes.labelActive]: selected === proto.id,
              })}
            >
              {proto.label}
            </Text>
          </UnstyledButton>
        </Tooltip>
      ))}
    </Box>
  );
}
