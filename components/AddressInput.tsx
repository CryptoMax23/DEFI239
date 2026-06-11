import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/router";
import { ethers } from "ethers";
import { t } from "@lingui/macro";

import { ActionIcon, Group, TextInput, Tooltip } from "@mantine/core";
import { FaCopy, FaExternalLinkAlt } from "react-icons/fa";
import { GiDiceSixFacesFive } from "react-icons/gi";
import { markets, useAaveData } from "../hooks/useAaveData";

type Props = {};

const sampleAddresses = [
  "0x50fc9731dace42caa45d166bff404bbb7464bf21",
  "0x7cd0b7ed790f626ef1bd42db63b5ebeb5970c912",
  "0xfa5484533acf47bc9f5d9dc931fcdbbdcefb4011",
  "0x5be9a4959308a0d0c7bc0870e319314d8d957dbb",
  "0xabbd5b2b0b034781e58434736728b9d0673de7f1",
  "0xe40d278afd00e6187db21ff8c96d572359ef03bf",
  "0x0591926d5d3b9cc48ae6efb8db68025ddc3adfa5",
  "0xefad748654ec2c072b8735c010ae2fdea04aaf7d",
  "0xb3abe0777aa9685941e54744e704378b4b33eeaa",
  "0x7c697d6cff279f3f9c2401d0ea2ac7e7ede0e2c3",
  "0x99926ab8e1b589500ae87977632f13cf7f70f242",
  "0x64471d103a7f77262529383d53bdd28b260b1ae8",
  "0x989b96317735d70a7762bf96c034b203713aae18",
  "0xce344e5ad5bab578601cbf8ad103506588d38455",
  "0x96f49d0e9724dfd8780fa667ac37a993f005cb94",
  "0xc9db4e8d3d940c16b800d433d168d2f651025642",
  "0xe84a061897afc2e7ff5fb7e3686717c528617487",
  "0xfe99cc4664a939f826dbeb545c1aad4c89ee737a",
  "0x517ce9b6d1fcffd29805c3e19b295247fcd94aef",
  "0x6313f5be9371d39069a6070e74632c3d9782a0d7",
];

const AddressInput = ({}: Props) => {
  const [inputAddress, setInputAddress] = useState("");
  const [showCopied, setShowCopied] = useState(false);
  const router = useRouter();

  const { currentAddress, currentMarket } = useAaveData("");
  const market = markets.find((m) => m.id === currentMarket);

  const randomAddress = useMemo(
    () => sampleAddresses[Math.floor(Math.random() * sampleAddresses.length)],
    []
  );

  useEffect(() => {
    if (
      ethers.utils.isAddress(inputAddress) ||
      isValidENSAddress(inputAddress)
    ) {
      handleSelectAddress(inputAddress);
    }
  }, [inputAddress]);

  useEffect(() => {
    if (currentAddress && currentAddress !== inputAddress)
      setInputAddress(currentAddress);
    if (inputAddress && !currentAddress) setInputAddress("");
  }, [currentAddress]);

  const handleSelectAddress = (address: string) => {
    setInputAddress(address);
    if (ethers.utils.isAddress(address) || isValidENSAddress(address)) {
      const query = { ...router?.query };
      query.address = address.trim();
      router.push({ pathname: router.pathname, query }, undefined, {
        locale: router.locale,
      });
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(inputAddress);
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 2500);
  };

  return (
    <TextInput
      value={inputAddress || ""}
      size="lg"
      placeholder="0x...1234 or bobloblaw.eth"
      onChange={(event) => setInputAddress(event.target.value?.trim())}
      inputWrapperOrder={["label", "error", "input", "description"]}
      rightSectionWidth={110}
      rightSection={
        <Group spacing={4} noWrap pr={4}>
          <Tooltip label={t`Use Random Address`} position="top" withArrow>
            <ActionIcon
              size="sm"
              onClick={() =>
                router.push(
                  {
                    pathname: router.pathname,
                    query: { ...router.query, address: randomAddress },
                  },
                  undefined,
                  { locale: router.locale }
                )
              }
            >
              <GiDiceSixFacesFive size={15} />
            </ActionIcon>
          </Tooltip>

          <Tooltip
            label={
              showCopied
                ? t`Address copied to clipboard!`
                : t`Copy address to clipboard`
            }
            opened={showCopied ? true : undefined}
            color={showCopied ? "green" : undefined}
            position="top"
            withArrow
          >
            <ActionIcon size="sm" onClick={handleCopy}>
              <FaCopy size={14} />
            </ActionIcon>
          </Tooltip>

          <Tooltip
            label={t`View address on ${market?.explorerName}`}
            position="top"
            withArrow
          >
            <ActionIcon
              size="sm"
              component="a"
              href={market?.explorer.replace("{{ADDRESS}}", inputAddress)}
              target="_blank"
              rel="noreferrer"
            >
              <FaExternalLinkAlt size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      }
    />
  );
};

export default AddressInput;

export const isValidENSAddress = (address: string) =>
  !!address?.length && address.length > 4 && address.endsWith(".eth");
