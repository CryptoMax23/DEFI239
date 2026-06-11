import * as React from "react";
import { Button, Menu } from "@mantine/core";
import { MdLanguage } from "react-icons/md";
import { FaChevronDown } from "react-icons/fa";
import { useRouter } from "next/router";

const languages = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
];

export default function SelectLanguageDialog() {
  const router = useRouter();
  const currentLocale = router.locale || "en";
  const currentLabel = currentLocale.toUpperCase();

  const handleSelect = (code: string) => {
    if (code !== currentLocale) {
      router.push(router.asPath, undefined, { locale: code });
    }
  };

  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <Button compact variant="light" mr="sm">
          <MdLanguage style={{ marginRight: "5px" }} />
          {currentLabel}
          <FaChevronDown size={10} style={{ marginLeft: "5px" }} />
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {languages.map((lang) => (
          <Menu.Item
            key={lang.code}
            onClick={() => handleSelect(lang.code)}
            fw={currentLocale === lang.code ? 700 : 400}
          >
            {lang.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
