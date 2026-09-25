# Payslip OCR

A mobile-first prototype for scanning Croatian payslips. A user photographs or uploads one or
more payslips, the system extracts their contents into a structured, pre-filled form, and the
user reviews and corrects that form before exporting it.

This glossary is the project's vocabulary. Croatian payroll terms are kept in Croatian because
their English translations are ambiguous in ways that cause real bugs — "income", "deduction"
and "contribution" each map to two or three distinct Croatian concepts.

## Document model

**Payslip**:
One employer's obračun of one employee's pay for one period. The unit a user reviews, corrects
and exports. A Payslip owns one or more Pages.
_Avoid_: Document, receipt, slip, payroll record

**Page**:
One rendered side of a Payslip, carrying its own geometry. Pages are the unit of display and of
bounding-box coordinates; they are never reviewed or exported independently.
_Avoid_: Sheet, image, scan

**Source File**:
One file the user supplied — a photo, a PNG, or a PDF. A Source File may contribute several
Pages (a multi-page PDF), and several Source Files may contribute Pages to one Payslip (two
photos of a two-page payslip).
_Avoid_: Upload, attachment, original

**Session**:
The set of Payslips a user uploaded together and reviews side by side, switching between them
without losing the others' state. A Session has no status of its own; its progress is read from
the Payslips it holds.
_Avoid_: Batch, upload, job

**Upload batch**:
The browser's transient record of the Source Files one tab is still sending into a Session: each
file waiting, uploading, uploaded or rejected. It lives only in client memory and ends once every
file has been sent. It is not a Session and has no server representation; the Session is what
persists. The client names it `UploadBatchProvider`, `BatchItem` and `startBatch` (Task 07).
_Avoid_: Using "batch" for the Session itself

**Merge**:
Replacing two Payslips that turn out to be pages of one with a single Payslip owning both
Pages. Merging combines the Source Files and re-extracts, rather than reconciling two sets of
already-extracted values.
_Avoid_: Join, combine, group

## Croatian payroll

**Obrazac IP1**:
The payslip form annexed to *Pravilnik NN 68/2023*. It prescribes required **content**, not
layout, and Article 10(1) makes its use optional — so every payroll vendor renders it
differently. "This document is an IP1" says nothing about where its fields sit.

**Bruto plaća**:
Total gross pay for the period, before any contribution or tax is withheld. The base from which
every other figure on the payslip derives.
_Avoid_: Gross salary, gross amount (use the Croatian term)

**Doprinosi iz plaće**:
Employee-side contributions withheld from Bruto plaća — mirovinsko osiguranje I. stup (15%) and
II. stup (5%). Reduces what the employee receives.
_Avoid_: Withholdings, deductions, employee contributions

**Doprinosi na plaću**:
Employer-side contributions paid *on top of* Bruto plaća — obvezno zdravstveno osiguranje
(16.5%). Never reduces the employee's pay; it raises the employer's cost. A distinct concept
from Doprinosi iz plaće despite the near-identical name.
_Avoid_: Benefits, employer taxes

**Dohodak**:
Bruto plaća minus Doprinosi iz plaće. The figure income tax is assessed against, before
allowances.
_Avoid_: Income, earnings, taxable income

**Osobni odbitak**:
The personal tax allowance subtracted from Dohodak before tax, raised for dependants and
disability. €600/month base from 2025.
_Avoid_: Personal deduction, tax-free allowance, olakšica (a payslip may print either word;
this project says Osobni odbitak)

**Porezna osnovica**:
Dohodak minus Osobni odbitak. The amount the tax rate is applied to. Floors at zero when the
allowance exceeds Dohodak.
_Avoid_: Tax base, taxable amount

**Porez na dohodak**:
Income tax charged on Porezna osnovica. Since 2024 the rate is set by the employee's
municipality rather than by a national rate plus Prirez.

**Prirez**:
A municipal surtax on Porez na dohodak, **abolished 1 January 2024** (NN 114/23). Appears only
on payslips for periods up to December 2023.

**Neto plaća**:
Dohodak minus Porez na dohodak. What the employee has earned after tax, before non-taxable
additions and before Obustave.
_Avoid_: Net salary, take-home pay (Iznos za isplatu is take-home, and they differ)

**Neoporezivi primici**:
Non-taxable payments added alongside salary — prehrana, prijevoz, terenski dodatak, putni
nalozi. Added after Neto plaća, never taxed.
_Avoid_: Allowances, benefits, reimbursements

**Obustave**:
Amounts withheld from the payout under an obligation to a third party — loan instalments, union
credit, garnishments. Each carries a creditor and often a remaining balance and instalment
count. Subtracted last.
_Avoid_: Deductions, withholdings, garnishments

**Iznos za isplatu**:
Neto plaća plus Neoporezivi primici minus Obustave. The amount actually transferred to the
employee's account, and the only figure on the payslip that matches their bank statement.
_Avoid_: Net pay, total, payout

**Ukupan trošak rada**:
Bruto plaća plus Doprinosi na plaću plus Neoporezivi primici. What the employee costs the
employer. Appears on most but not all layouts.
_Avoid_: Total cost, employer cost

**Pay component**:
One row of the earnings breakdown that sums to Bruto plaća — a named kind of work or supplement
with its hours, coefficient and amount (e.g. `REDOVAN RAD`, `DODATAK ZA RAD NOĆU`).
_Avoid_: Line item, item, earning

**OIB**:
The Croatian 11-digit personal or company identification number, carrying an ISO 7064 MOD 11,10
check digit. Two appear on every payslip — the employer's and the employee's — and conflating
them is the characteristic extraction bug.

## Review

**Source Region**:
A quadrilateral on one Page, expressed in page-relative fractions, that locates where an
extracted value was read from. Drives the highlight drawn over the document preview.
_Avoid_: Bounding box, highlight, annotation

**Extraction pass**:
One of the two analyses a Payslip's extraction is split into — the scalars pass, which makes the
form usable, and the tables pass, which fills the three line-item tables. They run over the same
document and land in either order.
_Avoid_: Phase, stage, job

**Extracted value**:
A value the system read from a Payslip, always a draft. It is never authoritative until the
user has reviewed it; low confidence marks a value for attention but never suppresses it.

**Critical field**:
One of the seven fields whose absence makes a Payslip not worth exporting — employer name,
employee name, employee OIB, period, bruto plaća, neto plaća, iznos za isplatu. Critical fields
raise a Warning when missing and are the ones accuracy is reported against.
_Avoid_: Required field, mandatory field (nothing is required; the form always saves)

**Unreadable field**:
A field whose text was found on the Page but could not be normalised into a value. Recorded as
unreadable rather than stored as a guess, so that "we could not read this" stays distinct from
"this was not on the document".

**Warning**:
A named, non-blocking observation about an extracted Payslip — a missing critical field, or an
arithmetic identity that does not reconcile. Warnings draw the user's attention; they never
prevent confirmation or export.

**Attention signal**:
A mark on an extracted value that asks the reviewer to check it — a Warning, low confidence, or an
ungroundable value (its printed text is not among the page's OCR words). Attention signals mark;
they never suppress a value or block a workflow.
_Avoid_: Error, validation failure, flag
