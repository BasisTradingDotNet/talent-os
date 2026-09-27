#!/usr/bin/env python3
"""Unit tests for redact.py.  Run: python3 -m unittest discover bench/screening"""
import json
import os
import re
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import redact  # noqa: E402

CV_DIR = os.path.join(HERE, "cvs")
LABELS_PATH = os.path.join(HERE, "labels.json")


class NameHeader(unittest.TestCase):
    def test_markdown_header(self):
        out = redact.redact("# Priya Raghunathan\n\n## Summary\nQuant trader.\n")
        self.assertIn("# [NAME]", out)
        self.assertNotIn("Priya", out)
        self.assertNotIn("Raghunathan", out)

    def test_all_caps_and_cv_prefix(self):
        for header in ("PRIYA RAGHUNATHAN", "Curriculum Vitae — Priya Raghunathan",
                       "Name: Priya Raghunathan", "**Priya Raghunathan**", "Priya Raghunathan, CFA"):
            out = redact.redact(header + "\nQuant trader, Kestrel Basis Capital.\n")
            self.assertNotIn("Raghunathan", out, header)
            self.assertNotIn("RAGHUNATHAN", out, header)

    def test_europass_surname_first_name_field(self):
        text = ("PERSONAL INFORMATION\nSurname(s) / First name(s): Kulkarni, Rohit\nAddress: Pune\n"
                "WORK EXPERIENCE\nQuant trader at Kestrel Basis Capital.\n")
        out = redact.redact(text)
        self.assertNotIn("Kulkarni", out)
        self.assertNotIn("Rohit", out)
        self.assertIn("Quant trader at Kestrel Basis Capital.", out)

    def test_two_column_header(self):
        out = redact.redact("Daniel Whitmore | d.whitmore@postbox.co.uk | +44 7700 900123\nLondon\n")
        self.assertTrue(out.startswith("[NAME] | [EMAIL] | [PHONE]"), out)

    def test_two_column_bare_label_cells(self):
        out = redact.redact("Location | London\nGender | Male\nDate of Birth | 3 May 1996\nAvailability | One month\n")
        self.assertEqual(out.strip().splitlines(), ["Location | London", "Availability | One month"])

    def test_later_occurrences_and_signature(self):
        text = ("Dear Hiring Manager,\n\nI am writing to apply for the Quant Trader role.\n\n"
                "Regards,\nAditya\n\nADITYA SHARMA\naditya.sharma91@mailhost.in\n\nEXPERIENCE\n"
                "Quant Trader, Kestrel Basis Capital, Mumbai, 2021 - 2024\n")
        out = redact.redact(text)
        self.assertNotIn("Aditya", out)
        self.assertNotIn("ADITYA", out)
        self.assertNotIn("Sharma", out)
        self.assertIn("Quant Trader, Kestrel Basis Capital, Mumbai, 2021 - 2024", out)

    def test_section_titles_are_not_names(self):
        out = redact.redact("Professional Summary\nSenior Quant Trader\nQuant trader with Python.\n")
        self.assertNotIn("[NAME]", out)

    def test_salutation_removed(self):
        out = redact.redact("Mr Daniel Whitmore\nd.whitmore@postbox.co.uk\n")
        self.assertNotIn("Mr", out)
        self.assertIn("[NAME]", out)


class ContactDetails(unittest.TestCase):
    def test_emails(self):
        out = redact.redact("Contact: priya.r+jobs@example.co.in, other@mailhost.in\n")
        self.assertEqual(out.count("[EMAIL]"), 2)
        self.assertNotIn("@", out)

    def test_phone_formats(self):
        for phone in ("+91 98765 43210", "09876543210", "9876543210", "+44 7700 900123", "07700 900123",
                      "(312) 555-0142", "312-555-0142", "+65 8123 4567", "Mobile: 98765-43210",
                      "Tel. +91-22-6789-1234"):
            out = redact.redact("Priya Raghunathan\n" + phone + "\n")
            self.assertIn("[PHONE]", out, phone)
            self.assertFalse(re.search(r"\d{5}", out), (phone, out))

    def test_years_are_not_phones(self):
        text = "Quant Trader, 2019 - 2023\nJan 2021 – Dec 2024\n2019-01-01 to 2023-12-31\nSharpe 2.1, 10000 orders/day\n"
        out = redact.redact(text)
        self.assertEqual(out, text)

    def test_social_urls(self):
        out = redact.redact("linkedin.com/in/priya-raghu | https://github.com/praghu | https://kestrel.example.com/team\n")
        self.assertEqual(out.count("[URL]"), 2)
        self.assertIn("https://kestrel.example.com/team", out)


class ProtectedCharacteristics(unittest.TestCase):
    def test_labelled_lines_dropped(self):
        text = ("PERSONAL DETAILS\nFather's Name: Ramesh Sharma\nDate of Birth: 14 March 1996\nAge: 28\n"
                "Gender: Male\nMarital Status: Single\nNationality: Indian\nReligion: Hindu\nCaste: OBC\n"
                "Category: General\nLanguages: Hindi, English\nPassport No: Z1234567\n")
        out = redact.redact(text)
        for bad in ("Father", "Birth", "Age:", "Gender", "Marital", "Religion", "Hindu", "Caste", "OBC",
                    "Category", "Passport"):
            self.assertNotIn(bad, out, bad)
        self.assertIn("Nationality: Indian", out)
        self.assertIn("Languages: Hindi, English", out)
        self.assertIn("PERSONAL DETAILS", out)

    def test_multi_field_line(self):
        out = redact.redact("DOB: 14/03/1996 | Gender: Female | Nationality: Indian | Marital Status: Married\n")
        self.assertEqual(out.strip(), "Nationality: Indian")

    def test_inline_after_separator(self):
        out = redact.redact("Based in Mumbai; Religion: Hindu, Caste: General\n")
        self.assertEqual(out.strip(), "Based in Mumbai")

    def test_bare_values_in_cells(self):
        out = redact.redact("Male | Single | Hindu | Indian\n")
        self.assertEqual(out.strip(), "Indian")

    def test_inline_age_and_born(self):
        out = redact.redact("Aged 28, born 14 March 1996 in Pune, 3 years old startup, Age 30.\n")
        self.assertNotIn("28", out)
        self.assertNotIn("1996", out)
        self.assertNotIn("Age 30", out)

    def test_markdown_table_rows(self):
        out = redact.redact("| Name | Priya Raghunathan |\n| Age | 28 |\n| Gender | Female |\n| Skills | Python |\n")
        self.assertEqual(out.strip().splitlines(), ["| Name | [NAME] |", "| Skills | Python |"])

    def test_photo_references(self):
        text = "[Photo]\n![photo](photo.jpg)\nPhotograph: passport-size attached\nPhoto: headshot.png\nBuilt a PNG chart exporter.\n"
        out = redact.redact(text)
        self.assertEqual(out.strip(), "Built a PNG chart exporter.")

    def test_trading_text_untouched(self):
        text = ("Average latency 3ms; leverage 10x; Pan-European coverage; margin call handling; "
                "the stage-2 rollout; sex-agnostic\n"
                "- Age-weighted order book imbalance signal (research)\n")
        out = redact.redact(text)
        self.assertIn("Average latency 3ms; leverage 10x; Pan-European coverage; margin call handling", out)
        self.assertIn("stage-2 rollout", out)


class Idempotence(unittest.TestCase):
    def test_double_redaction_is_stable(self):
        text = ("# Priya Raghunathan\npriya@example.com | +91 98765 43210\nGender: Female\n\n"
                "## Experience\nQuant Trader, Kestrel Basis Capital (2021 - 2024)\n")
        once = redact.redact(text)
        self.assertEqual(redact.redact(once), once)


@unittest.skipUnless(os.path.isdir(CV_DIR) and os.path.exists(LABELS_PATH), "dataset not built yet")
class Dataset(unittest.TestCase):
    """Every synthetic CV must come out clean."""

    def setUp(self):
        with open(LABELS_PATH, "r", encoding="utf-8") as fh:
            self.labels = json.load(fh)["cvs"]
        self.texts = {}
        for cid in self.labels:
            with open(os.path.join(CV_DIR, cid + ".md"), "r", encoding="utf-8") as fh:
                self.texts[cid] = fh.read()

    def test_no_contact_details_survive(self):
        for cid, raw in self.texts.items():
            out = redact.redact(raw)
            self.assertIsNone(redact._EMAIL.search(out), cid)
            self.assertIsNone(re.search(r"(?i)\b(?:date of birth|dob|gender|marital|religion|caste)\s*:", out), cid)
            self.assertIsNone(re.search(r"(?i)\bphoto(?:graph)?\b", out), (cid, "photo reference survived"))
            self.assertIsNone(re.search(r"linkedin\.com/", out), cid)
            self.assertIsNone(re.search(r"\d{10}|\d{5}[\s\-]\d{5}|\(\d{3}\)\s?\d{3}|\+\d{2}[\s\-]?\d{4}", out), cid)
            for line in out.splitlines():
                if re.search(r"(?i)\b(?:phone|mobile|mob|tel|cell|whatsapp)\b", line):
                    self.assertLess(sum(ch.isdigit() for ch in line), 6, (cid, line))

    def test_names_are_masked(self):
        for cid, lab in self.labels.items():
            raw = self.texts[cid]
            name = redact.detect_name(raw)
            self.assertIsNotNone(name, "%s: no name detected in header" % cid)
            out = redact.redact(raw)
            for tok in name.split():
                if len(tok.strip(".")) >= 3:
                    self.assertIsNone(re.search(r"(?<!\w)%s(?!\w)" % re.escape(tok), out), (cid, tok))
            cf = lab.get("cf_fields")
            if cf:
                self.assertEqual(name, cf["full_name"], cid)
                self.assertNotIn(cf["surname"], out, cid)
                self.assertNotIn(cf["first_name"], out, cid)


if __name__ == "__main__":
    unittest.main()
