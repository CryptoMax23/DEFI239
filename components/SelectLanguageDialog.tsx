import * as React from "react";
import { Button, Menu } from "@mantine/core";
import { MdLanguage } from "react-icons/md";
import { FaChevronDown } from "react-icons/fa";
import { BsCheckLg } from "react-icons/bs";
import { useRouter } from "next/router";

const languages = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
];

export default function SelectLanguageDialog() {
  const router = useRouter();
  const currentLocale = router.locale || "en";

  const handleSelect = (code: string) => {
    if (code !== currentLocale) {
      router.push(router.asPath, undefined, { locale: code });
    }
  };

  return (
    <Menu width={160} position="bottom-end">
      <Menu.Target>
        <Button compact variant="light" mr="sm">
          <MdLanguage style={{ marginRight: "5px" }} />
          {currentLocale.toUpperCase()}
          <FaChevronDown size={10} style={{ marginLeft: "5px" }} />
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {languages.map((lang) => (
          <Menu.Item
            key={lang.code}
            onClick={() => handleSelect(lang.code)}
            icon={
              currentLocale === lang.code ? (
                <BsCheckLg size={12} />
              ) : (
                <span style={{ width: 12, display: "inline-block" }} />
              )
            }
          >
            {lang.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
