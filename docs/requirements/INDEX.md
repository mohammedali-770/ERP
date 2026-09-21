# Requirement index

<!-- GENERATED FILE — do not edit by hand. Regenerate with: npm run req:index -->

Generated from `docs/source/First_Taste_ERP_PRD_v0.9.docx`. **387 requirements.**

Annotations (owner, status, ADR and test links) are maintained in
[`annotations.yaml`](./annotations.yaml); the full machine-readable catalogue is
[`requirements.yaml`](./requirements.yaml).

## By phase

| Phase | Count |
|---|---|
| F0 | 33 |
| F1 | 164 |
| F2 | 19 |
| F3 | 37 |
| F4 | 81 |
| F5 | 49 |
| F6 | 2 |
| Future | 2 |

## By module

| Module | Count | Section |
|---|---|---|
| [POS](#pos) | 30 | 5.3 Point of sale |
| [FIN](#fin) | 20 | 5.14 Finance and accounting |
| [AI](#ai) | 20 | 5.22 AI assistant and internal auditor |
| [PAY](#pay) | 19 | 5.7 Payments cash refunds and ZATCA |
| [INV](#inv) | 19 | 5.11 Inventory and replenishment |
| [OMS](#oms) | 18 | 5.5 Order management |
| [MNU](#mnu) | 16 | 5.4 Menu pricing recipes and availability |
| [APP](#app) | 16 | 5.9 Customer application |
| [HR](#hr) | 16 | 5.15 Human resources and payroll |
| [NFR](#nfr) | 16 | 7.1 Nonfunctional requirements |
| [PRG](#prg) | 15 | 5.1 Program foundation |
| [PRN](#prn) | 15 | 5.6 Kitchen printing and barcode readiness |
| [SEC](#sec) | 15 | 7.2 Security and privacy |
| [OFF](#off) | 14 | 5.8 Offline operation and synchronization |
| [MFG](#mfg) | 12 | 5.12 Factory management |
| [EMP](#emp) | 12 | 5.16 First Taste employee application |
| [RPT](#rpt) | 12 | 5.21 Reporting and analytics |
| [CRM](#crm) | 11 | 5.10 Customer relationship and loyalty |
| [IAM](#iam) | 10 | 5.2 Identity access and roles |
| [DLV](#dlv) | 10 | 5.17 Delivery operations |
| [CC](#cc) | 10 | 5.18 Call center and PBX |
| [MKT](#mkt) | 10 | 5.19 Social media and marketing |
| [PRC](#prc) | 9 | 5.13 Procurement and suppliers |
| [AST](#ast) | 9 | 5.20 Assets and maintenance |
| [SUP](#sup) | 9 | 5.23 Support monitoring and notifications |
| [ACC](#acc) | 9 | 8.1 Lab and release requirements |
| [REL](#rel) | 6 | 8.1 Lab and release requirements |
| [LAB](#lab) | 5 | 8.1 Lab and release requirements |
| [OPS](#ops) | 4 | 5.24 Branch opening and closing |

## ACC

_8.1 Lab and release requirements_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `ACC-001` | F1 | P0 | Product Owner | T-01, SPIKE-offline-sync | Executive acceptance shall require evidence that no accepted order is lost or duplicated. |
| `ACC-002` | F1 | P0 | Product Owner | T-03, SPIKE-print-queue | Executive acceptance shall require reliable receipt and kitchen printing under simultaneous channel load. |
| `ACC-003` | F1 | P0 | Product Owner | T-05 | Executive acceptance shall require accurate payments, refunds, cash shifts and blind closing. |
| `ACC-004` | F1 | P0 | Product Owner | T-02, SPIKE-offline-sync | Executive acceptance shall require stable offline operation and automatic recovery synchronization. |
| `ACC-005` | F1 | P0 | Product Owner | T-09, SPIKE-zatca-counter-chain | Executive acceptance shall require correct ZATCA documents and successful deferred synchronization. |
| `ACC-006` | F1 | P0 | Product Owner | UAT-cashier, UAT-kitchen | Executive acceptance shall require cashier and kitchen user-acceptance testing and documented training readiness. |
| `ACC-007` | F1 | P0 | Product Owner | UAT-executive-acceptance | Executive acceptance shall require accurate management reports reconciled to source transactions. |
| `ACC-008` | F1 | P0 | Product Owner | T-01, SPIKE-offline-sync | Executive acceptance shall require successful testing above 200 orders per hour per branch with the approved device configuration. |
| `ACC-009` | F2 | P0 | — | — | All critical and high defects affecting order, payment, printing, ZATCA, security or synchronization shall be closed or formally accepted before production approval. |

## AI

_5.22 AI assistant and internal auditor_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `AI-001` | F5 | P0 | — | — | The ERP shall provide a dedicated First Taste AI assistant, initially optimized for Spicy Meal operations and expandable to other brands. |
| `AI-002` | F5 | P0 | — | — | The AI shall operate through explicit tools and permissions rather than unrestricted direct database access. |
| `AI-003` | F5 | P0 | — | — | The AI may automatically generate and distribute internal reports to authorized recipients. |
| `AI-004` | F5 | P0 | — | — | The AI may automatically create and assign internal tasks within approved rules. |
| `AI-005` | F5 | P0 | — | — | The AI may automatically send stock and maintenance alerts. |
| `AI-006` | F5 | P0 | — | — | The AI may answer employee policy questions using approved current documents. |
| `AI-007` | F5 | P0 | — | — | The AI may prepare inventory recommendations without placing or approving sensitive purchases unless separately authorized. |
| `AI-008` | F5 | P0 | — | — | The AI may respond to simple customer questions using approved knowledge and escalation rules. |
| `AI-009` | F5 | P0 | — | — | The AI may update non-financial operational records within approved field and workflow limits. |
| `AI-010` | F5 | P0 | — | — | The AI may schedule social content only after that content has been approved by management. |
| `AI-011` | F5 | P0 | — | — | Financial postings, price changes, refunds outside predefined rules, payroll changes, HR actions, access changes and record deletion shall require human authorization. |
| `AI-012` | F5 | P0 | — | — | Each AI action shall record model or agent identity, user or trigger, inputs, tools used, output, approvals and result. |
| `AI-013` | F5 | P0 | — | — | AI knowledge shall use versioned approved sources and shall expose source references for material answers. |
| `AI-014` | F5 | P0 | — | — | The system shall prevent customer, employee and financial data from being sent to an AI provider beyond approved purpose and configuration. |
| `AI-015` | F5 | P0 | — | — | AI automation shall support kill switches, rate limits, cost limits and rollback or compensation where possible. |
| `AI-016` | F5 | P0 | — | — | The AI Internal Auditor shall continuously monitor cashier shortages, refunds, voids, discounts, inventory variance, waste, purchasing, suppliers, payroll, attendance, access, ZATCA controls, policy compliance and AI actions. |
| `AI-017` | F5 | P0 | — | — | AI audit findings shall include evidence, affected records, control rule, severity, confidence and recommended action. |
| `AI-018` | F5 | P0 | — | — | The AI Internal Auditor shall create findings and tasks but shall not serve as a substitute for statutory audit, legal accountability or executive approval. |
| `AI-019` | F5 | P0 | — | — | Users shall be able to challenge, correct and close AI findings with evidence; the original finding shall remain auditable. |
| `AI-020` | F5 | P0 | — | — | AI quality shall be evaluated through test cases, approval rates, false positives, harmful-action prevention and business outcome measures. |

## APP

_5.9 Customer application_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `APP-001` | F1 | P0 | Product Owner | UAT-customer-app | The existing Spicy Meal customer application shall be migrated from its current backend dependencies to First Taste ERP services. |
| `APP-002` | F1 | P0 | Product Owner | UAT-customer-app | The migration shall preserve approved customer functions and shall not require an unnecessary complete application rewrite. |
| `APP-003` | F1 | P0 | Product Owner | UAT-customer-app | Customers shall be identified primarily by mobile number with one-time-password verification. |
| `APP-004` | F1 | P0 | Product Owner | UAT-customer-app | Saudi mobile number normalization shall accept approved local and international formats and store one canonical value. |
| `APP-005` | F1 | P0 | Product Owner | UAT-customer-app | The customer app shall support Arabic right-to-left and English left-to-right interfaces. |
| `APP-006` | F1 | P0 | Product Owner | UAT-customer-app | The customer shall select or confirm branch and order type before an order is finalized. |
| `APP-007` | F1 | P0 | Product Owner | UAT-customer-app | The app shall suggest the nearest eligible branch using approved location and serviceability rules. |
| `APP-008` | F1 | P0 | Product Owner | UAT-customer-app | The app shall use the ERP menu, pricing, availability, modifiers and promotions as its authoritative source. |
| `APP-009` | F1 | P0 | Product Owner | UAT-customer-app | The app shall support pickup and company delivery, with delivery-platform orders remaining external channel orders. |
| `APP-010` | F1 | P0 | Product Owner | UAT-customer-app | Delivery addresses shall support a map location, coordinates, Saudi short address, text directions and an order-time snapshot. |
| `APP-011` | F1 | P0 | Product Owner | UAT-customer-app | The app shall display banners, branch information, opening hours, minimum order and order status from managed ERP data. |
| `APP-012` | F1 | P0 | Product Owner | T-04 | The app shall prevent duplicate payments and duplicate orders during retry or delayed response conditions. |
| `APP-013` | F1 | P0 | Product Owner | T-04 | A failed order submission after verified payment shall follow controlled retries and automatic-refund rules. |
| `APP-014` | F1 | P0 | Product Owner | UAT-customer-app | Customers shall be able to view their order history, payment and refund status using authorized data. |
| `APP-015` | F1 | P0 | Product Owner | UAT-customer-app | Customer notifications shall support order events and approved marketing consent preferences. |
| `APP-016` | F5 | P0 | — | — | The customer app shall expose support and complaint entry points linked to the CRM case record. |

## AST

_5.20 Assets and maintenance_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `AST-001` | F4 | P0 | — | — | The ERP shall track all company assets and equipment. |
| `AST-002` | F4 | P0 | — | — | Asset records shall support category, serial, model, location, custodian, supplier, cost, warranty, status and documents. |
| `AST-003` | F4 | P0 | — | — | Assets shall include POS and IT devices, printers, kitchen equipment, factory equipment, vehicles, network equipment and spare assets. |
| `AST-004` | F4 | P0 | — | — | The system shall support breakdown tickets, preventive maintenance schedules, warranty and service contracts, and spare-parts inventory. |
| `AST-005` | F4 | P0 | — | — | Maintenance requests shall support priority, impact, location, asset, owner, service target, evidence and resolution. |
| `AST-006` | F4 | P0 | — | — | Preventive maintenance shall generate work orders before due dates and escalate overdue work. |
| `AST-007` | F4 | P0 | — | — | Spare-part issues shall reduce inventory and link to the serviced asset and work order. |
| `AST-008` | F4 | P0 | — | — | Asset transfer, assignment, return, retirement and disposal shall use controlled workflows and history. |
| `AST-009` | F4 | P0 | — | — | SIM cards and branch connectivity assets shall be traceable to their locations and service details. |

## CC

_5.18 Call center and PBX_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `CC-001` | F2 | P0 | — | — | The ERP shall integrate with the Yeastar call-center environment through supported interfaces. |
| `CC-002` | F2 | P0 | — | — | An inbound call shall identify and open the matching customer when caller identity is available and permitted. |
| `CC-003` | F2 | P0 | — | — | Agents shall be able to view the customer's previous orders and active cases according to permissions. |
| `CC-004` | F2 | P0 | — | — | Agents shall create and track orders using the same menu, pricing, availability and OMS rules as other channels. |
| `CC-005` | F2 | P0 | — | — | Authorized users shall be able to click to call from customer and order records. |
| `CC-006` | F2 | P0 | — | — | Call recordings shall be linked to authorized customer cases or interactions without exposing them broadly. |
| `CC-007` | F2 | P0 | — | — | The system shall report agent availability, call volume, answer rate, abandoned calls, handling time and order conversion where data is available. |
| `CC-008` | F2 | P0 | — | — | PBX integration failures shall not block manual order entry. |
| `CC-009` | F5 | P1 | — | — | The architecture shall reserve controlled interfaces for a future AI voice agent. |
| `CC-010` | F5 | P0 | — | — | A future AI voice agent shall not place paid orders, issue refunds or make sensitive changes without approved controls. |

## CRM

_5.10 Customer relationship and loyalty_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `CRM-001` | F5 | P0 | — | — | The ERP shall maintain one customer profile per verified mobile number, with controlled merge and duplicate resolution. |
| `CRM-002` | F5 | P0 | — | — | The customer profile shall combine approved activity from the customer app, POS, call center, WhatsApp and delivery channels where identity can be matched lawfully. |
| `CRM-003` | F5 | P0 | — | — | The loyalty engine shall support spending points, visit or order-count rewards, tiered membership, cashback or wallet, coupons and personalized offers. |
| `CRM-004` | F5 | P0 | — | — | Loyalty rules shall be configurable by brand, branch, channel, product, customer segment, date, limit and exclusion. |
| `CRM-005` | F5 | P0 | — | — | Loyalty balances shall use an auditable ledger for accrual, redemption, expiry, reversal and manual adjustment. |
| `CRM-006` | F5 | P0 | — | — | Manual loyalty adjustments shall require role-based authorization and a reason. |
| `CRM-007` | F5 | P0 | — | — | Customer cases shall support category, severity, branch, order link, owner, service deadline, evidence, action and closure reason. |
| `CRM-008` | F5 | P0 | — | — | Multiple issues raised in one conversation shall be consolidated into one organized case where practical. |
| `CRM-009` | F5 | P1 | — | — | Positive feedback shall be recorded and acknowledged without unnecessary escalation. |
| `CRM-010` | F5 | P0 | — | — | If verified nutrition, ingredient or allergen information is unavailable, customer-facing automation shall not guess. |
| `CRM-011` | F5 | P0 | — | — | Customer consent, communication preference, retention and deletion workflows shall be recorded and enforced. |

## DLV

_5.17 Delivery operations_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `DLV-001` | F4 | P0 | — | — | The ERP shall support Spicy Meal company drivers and third-party delivery platforms. |
| `DLV-002` | F4 | P0 | — | — | Company-driver orders shall support both manual dispatcher assignment and automatic assignment. |
| `DLV-003` | F4 | P0 | — | — | Automatic assignment shall use configurable eligibility, availability, branch, service zone, capacity and distance rules. |
| `DLV-004` | F4 | P0 | — | — | Dispatchers shall be able to override an automatic assignment with a reason. |
| `DLV-005` | F4 | P0 | — | — | Drivers shall receive assignment, order, pickup, address and navigation information through the employee app. |
| `DLV-006` | F4 | P0 | — | — | Driver status shall include available, assigned, at branch, picked up, at customer, delivered and failed delivery. |
| `DLV-007` | F4 | P0 | — | — | The system shall support proof of delivery, delivery notes, customer contact controls and failed-delivery reasons. |
| `DLV-008` | F4 | P0 | — | — | Cash collected by drivers shall be assigned, reconciled and handed over through controlled records. |
| `DLV-009` | F4 | P0 | — | — | Driver and delivery performance shall include acceptance, pickup, travel, delivery, failure and cash-settlement measures. |
| `DLV-010` | F4 | P0 | — | — | Customer location and contact data shall be exposed only for the active delivery and retained according to approved policy. |

## EMP

_5.16 First Taste employee application_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `EMP-001` | F4 | P0 | — | — | First Taste shall provide one role-based mobile application for employees rather than separate apps for each job type. |
| `EMP-002` | F4 | P0 | — | — | The employee app shall provide attendance and work schedules. |
| `EMP-003` | F4 | P0 | — | — | The employee app shall provide leave and permission requests with status tracking. |
| `EMP-004` | F4 | P0 | — | — | The employee app shall provide payslips and authorized HR documents. |
| `EMP-005` | F4 | P0 | — | — | The employee app shall provide company announcements and require acknowledgement where configured. |
| `EMP-006` | F4 | P0 | — | — | The employee app shall provide assigned tasks and checklists with due dates, evidence and completion state. |
| `EMP-007` | F4 | P0 | — | — | Managers shall be able to review and decide assigned approvals from the app. |
| `EMP-008` | F4 | P0 | — | — | Driver functions shall appear only to authorized drivers and dispatchers. |
| `EMP-009` | F4 | P0 | — | — | Employees shall be able to submit maintenance and IT requests with category, description, location and attachments. |
| `EMP-010` | F4 | P0 | — | — | The app shall provide training content, policies, tests and acknowledgement records. |
| `EMP-011` | F4 | P0 | — | — | The employee app shall support Arabic and English and role-specific home screens. |
| `EMP-012` | F4 | P0 | — | — | Future employee-app functions may be added through modular role permissions without requiring separate applications. |

## FIN

_5.14 Finance and accounting_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `FIN-001` | F4 | P0 | — | — | The ERP shall contain a complete native accounting system rather than only exporting journals to another accounting product. |
| `FIN-002` | F4 | P0 | — | — | The first accounting implementation shall cover one legal company. |
| `FIN-003` | F4 | P1 | — | — | The data model shall remain capable of adding legal companies and consolidation later. |
| `FIN-004` | F4 | P0 | — | — | The system shall provide configurable chart of accounts, fiscal periods, journals and posting rules. |
| `FIN-005` | F4 | P0 | — | — | Financial entries shall support dimensions for company, brand, branch, sales channel, department or cost center, product, factory and warehouse. |
| `FIN-006` | F4 | P0 | — | — | The system shall report profit and loss for each required dimension and approved combinations. |
| `FIN-007` | F4 | P0 | — | — | Posted entries shall be immutable and corrected through controlled reversal or adjustment entries. |
| `FIN-008` | F4 | P0 | — | — | POS sales, tax, discounts, refunds, cash, card, wallet, delivery receivables and cost of goods sold shall post automatically according to approved rules. |
| `FIN-009` | F4 | P0 | — | — | The system shall support accounts payable, supplier invoice workflow, payment scheduling and supplier statements. |
| `FIN-010` | F4 | P0 | — | — | The system shall support accounts receivable for delivery platforms, corporate customers and other approved debtors. |
| `FIN-011` | F4 | P0 | — | — | The system shall support bank accounts, cash accounts, petty cash, deposits, transfers and bank reconciliation. |
| `FIN-012` | F4 | P0 | — | — | The system shall reconcile cashier closing with POS payments, deposits and accounting postings. |
| `FIN-013` | F4 | P0 | — | — | The system shall support VAT configuration, tax reports and evidence required for approved filings. |
| `FIN-014` | F4 | P0 | — | — | The system shall support fixed assets, capitalization, depreciation, transfer, impairment and disposal. |
| `FIN-015` | F4 | P0 | — | — | The system shall support budgets by financial dimension and compare commitments and actuals against budget. |
| `FIN-016` | F4 | P0 | — | — | The system shall support month-end and year-end closing checklists, period locks and controlled reopening. |
| `FIN-017` | F4 | P0 | — | — | Financial statements shall include at minimum trial balance, income statement, balance sheet and cash flow. |
| `FIN-018` | F4 | P0 | — | — | The system shall retain supporting documents and approvals linked to accounting transactions. |
| `FIN-019` | F4 | P0 | — | — | The finance module shall support controlled imports and exports for banking, audit and statutory reporting where direct integration is unavailable. |
| `FIN-020` | F4 | P0 | — | — | All financial reports shall preserve drill-down from summary to source transaction and audit history. |

## HR

_5.15 Human resources and payroll_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `HR-001` | F4 | P0 | — | — | The ERP shall provide complete human-resources and payroll functionality. |
| `HR-002` | F4 | P0 | — | — | Employee master data shall include identity, employment, contact, organization, contract, compensation, bank and document records subject to permissions. |
| `HR-003` | F4 | P0 | — | — | The system shall support recruitment, offer, onboarding, probation, transfer, promotion, disciplinary action, offboarding and final settlement workflows. |
| `HR-004` | F4 | P0 | — | — | Attendance shall support multiple capture methods including biometric devices, employee mobile app, branch kiosk and authorized manager entry. |
| `HR-005` | F4 | P0 | — | — | Attendance source, time, location, device and manual-adjustment history shall be retained. |
| `HR-006` | F4 | P0 | — | — | The system shall support shift templates, branch schedules, split shifts, rest periods, substitutions and published rosters. |
| `HR-007` | F4 | P0 | — | — | Leave and permission requests shall use configurable balances, evidence, approval paths and payroll effects. |
| `HR-008` | F4 | P0 | — | — | Payroll shall support salary, allowances, overtime, deductions, advances, absence, leave, incentives and end-of-service components. |
| `HR-009` | F4 | P0 | — | — | Payroll calculations shall be versioned, reviewable and approved before posting or payment. |
| `HR-010` | F4 | P0 | — | — | Approved payroll shall create controlled accounting entries and payment files or instructions. |
| `HR-011` | F4 | P0 | — | — | The system shall prepare data and records needed for GOSI, Qiwa and other applicable official workflows where supported. |
| `HR-012` | F4 | P0 | — | — | Official-service integration shall use supported APIs or authorized providers and shall not automate prohibited portal activity. |
| `HR-013` | F4 | P0 | — | — | Employee documents, contracts, permits and certifications shall support expiry alerts and restricted access. |
| `HR-014` | F4 | P0 | — | — | The system shall support performance goals, evaluations, training history and policy acknowledgements. |
| `HR-015` | F4 | P0 | — | — | Payroll and sensitive HR data shall be visible only to specifically authorized roles. |
| `HR-016` | F4 | P0 | — | — | The AI Internal Auditor shall detect attendance, payroll and access anomalies but shall not impose disciplinary or payroll changes automatically. |

## IAM

_5.2 Identity access and roles_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `IAM-001` | F1 | P0 | IT and system administration | T-10 | Employees shall sign in with employee ID and password. |
| `IAM-002` | F1 | P0 | IT and system administration | T-10 | System administrators shall be required to use multi-factor authentication. |
| `IAM-003` | F1 | P0 | IT and system administration | T-10 | Permissions shall be based on account type and configurable by role, action, amount, branch, department and data scope. |
| `IAM-004` | F1 | P0 | IT and system administration | T-10 | The system shall provide separate dashboards and access profiles for executives, finance, HR, operations, branch management, warehouse, procurement, factory, marketing, customer service and IT. |
| `IAM-005` | F1 | P0 | IT and system administration | T-10 | Sensitive actions shall support limits and approval rules by role rather than one fixed approval flow. |
| `IAM-006` | F1 | P0 | IT and system administration | T-10 | User access shall be limited to assigned companies, brands, branches, departments and functions. |
| `IAM-007` | F1 | P1 | — | — | The system shall support temporary access with start and expiry dates. |
| `IAM-008` | F1 | P0 | IT and system administration | T-10 | All sign-in attempts, permission changes and privileged actions shall be recorded in tamper-evident audit logs. |
| `IAM-009` | F4 | P0 | — | — | Terminated or suspended employee accounts shall be disabled through an approved HR or administrator workflow. |
| `IAM-010` | F1 | P1 | — | — | The platform shall support trusted-device registration and session revocation. |

## INV

_5.11 Inventory and replenishment_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `INV-001` | F3 | P0 | — | — | Every completed sale shall deduct recipe ingredients and packaging from branch inventory in real time. |
| `INV-002` | F3 | P0 | — | — | The system shall support raw ingredients, factory-made semi-finished items, ready-to-sell finished products, packaging, cleaning supplies, operating supplies, equipment and spare parts. |
| `INV-003` | F3 | P0 | — | — | Inventory shall be tracked by company, brand where applicable, facility, storage location, item, unit and stock status. |
| `INV-004` | F3 | P0 | — | — | Food and factory stock shall track batch, production date and expiry date. |
| `INV-005` | F3 | P0 | — | — | The system shall support unit conversion and prevent ambiguous conversions between purchase, production, storage and recipe units. |
| `INV-006` | F3 | P0 | — | — | Stock movements shall include receipt, issue, sale consumption, production consumption, production output, transfer, return, adjustment, waste, damage and expiry. |
| `INV-007` | F3 | P0 | — | — | Every stock movement shall record source document, user, date, quantity, unit, location, batch where applicable and approval state. |
| `INV-008` | F3 | P0 | — | — | Negative stock shall be prevented or explicitly controlled through an exception approval policy. |
| `INV-009` | F3 | P0 | — | — | Stock counts shall support full counts, cycle counts, blind counts, recounts and approved variances. |
| `INV-010` | F3 | P0 | — | — | The system shall calculate theoretical consumption from sales and compare it with actual stock movement. |
| `INV-011` | F3 | P0 | — | — | Inventory variance shall be analyzed by item, branch, period, recipe, user and reason. |
| `INV-012` | F3 | P0 | — | — | Expiry monitoring shall produce alerts and support first-expiry-first-out picking where configured. |
| `INV-013` | F3 | P0 | — | — | The system shall support minimum, maximum, safety-stock and reorder values by location. |
| `INV-014` | F3 | P0 | — | — | Branch replenishment shall support manual requests, system-suggested quantities and automatic orders. |
| `INV-015` | F3 | P0 | — | — | Suggested and automatic replenishment shall consider sales, forecast, current stock, open transfers, expiry, lead time and capacity. |
| `INV-016` | F3 | P0 | — | — | Branch users shall confirm receipt and record shortage, excess, substitution, damage and rejected quantities. |
| `INV-017` | F3 | P0 | — | — | Transfers shall preserve dispatch, in-transit and receiving accountability. |
| `INV-018` | F3 | P1 | — | — | The inventory module shall support barcode or QR scanning for receiving, transfer, picking, counting and issue where beneficial. |
| `INV-019` | F4 | P0 | — | — | Inventory valuation shall integrate with native accounting using the approved costing policy. |

## LAB

_8.1 Lab and release requirements_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `LAB-001` | F0 | P0 | — | — | First Taste shall operate a complete ERP and POS lab at head office before any production branch rollout. |
| `LAB-002` | F0 | P0 | — | — | The lab shall represent one complete branch with up to three POS devices, receipt printer, kitchen printer, barcode reader, payment terminal or simulator and managed network controls. |
| `LAB-003` | F1 | P0 | Product Owner | UAT-lab-readiness | The lab shall provide controlled disconnection, latency, device restart, printer outage and service-failure simulation. |
| `LAB-004` | F1 | P0 | Product Owner | UAT-lab-readiness | The lab shall use non-production payment, ZATCA and external-channel environments or approved simulators. |
| `LAB-005` | F1 | P0 | Product Owner | UAT-lab-readiness | The lab shall retain repeatable test data and scripts for regression testing after every material release. |

## MFG

_5.12 Factory management_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `MFG-001` | F3 | P0 | — | — | Factory production planning shall support confirmed branch requests, sales forecasts and minimum-stock rules. |
| `MFG-002` | F3 | P0 | — | — | Production orders generated by any method shall require manager approval before release. |
| `MFG-003` | F3 | P0 | — | — | The system shall support multi-level bills of material for raw, semi-finished and finished products. |
| `MFG-004` | F3 | P0 | — | — | A production order shall specify product, recipe version, planned quantity, facility, planned date, required materials and target batch. |
| `MFG-005` | F3 | P0 | — | — | Material issue and finished output shall be recorded by batch, quantity, unit and responsible employee. |
| `MFG-006` | F3 | P0 | — | — | The system shall record actual yield, expected yield, production loss, rework and waste. |
| `MFG-007` | F3 | P0 | — | — | Finished and semi-finished output shall receive production and expiry dates according to approved shelf-life rules. |
| `MFG-008` | F3 | P0 | — | — | The system shall provide forward and backward batch traceability between materials, production batches and receiving branches. |
| `MFG-009` | F4 | P0 | — | — | Production costing shall include materials and configurable labor and overhead components. |
| `MFG-010` | F3 | P1 | — | — | Factory capacity and planned workload shall be visible when approving production orders. |
| `MFG-011` | F3 | P1 | — | — | The system shall support hold, release, reject and recall statuses for batches. |
| `MFG-012` | F3 | P0 | — | — | Existing factory and warehouse workflows shall be optimized and migrated through approved process mapping rather than copied without review. |

## MKT

_5.19 Social media and marketing_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `MKT-001` | F5 | P0 | — | — | The social module shall support approved connectors for WhatsApp, Instagram, Snapchat, TikTok and Google Business Profile where platform APIs permit. |
| `MKT-002` | F5 | P0 | — | — | Users shall schedule and publish approved content by brand, account, channel and date. |
| `MKT-003` | F5 | P0 | — | — | All external publishing shall require management approval before release. |
| `MKT-004` | F5 | P0 | — | — | The system shall provide a unified inbox for supported messages and comments. |
| `MKT-005` | F5 | P0 | — | — | Customer complaints detected in social channels shall be routed to customer service with channel context and evidence. |
| `MKT-006` | F5 | P0 | — | — | The system shall monitor supported reviews and brand mentions and assign response ownership. |
| `MKT-007` | F5 | P0 | — | — | Campaigns shall link content, audience, coupon, spend, orders and revenue where attribution is reliable. |
| `MKT-008` | F5 | P0 | — | — | AI may draft content and responses, but management approval shall remain mandatory before external publishing. |
| `MKT-009` | F5 | P0 | — | — | Integration connectors shall be replaceable because external platform APIs and permissions may change. |
| `MKT-010` | F5 | P0 | — | — | The system shall retain publication, approval, edit and response history. |

## MNU

_5.4 Menu pricing recipes and availability_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `MNU-001` | F1 | P0 | Operations management | UAT-menu | Head office shall control products, recipes, menu structure and selling prices. |
| `MNU-002` | F1 | P0 | Operations management | T-06 | Branches shall control item availability within permissions but shall not change selling prices. |
| `MNU-003` | F1 | P0 | Operations management | T-06 | When making an item unavailable, the cashier shall select an automatic return date and time. |
| `MNU-004` | F1 | P0 | Operations management | T-06 | The system shall automatically restore the item at the selected time and record who created the unavailability period. |
| `MNU-005` | F1 | P0 | Operations management | UAT-menu | Menu publication shall support company, brand, branch, channel, order type and effective date ranges. |
| `MNU-006` | F1 | P0 | Operations management | UAT-menu | Products shall support Arabic and English names, descriptions, images and receipts or kitchen labels. |
| `MNU-007` | F1 | P0 | Operations management | UAT-menu | Products shall support sizes, variants, modifiers, modifier groups, defaults, minimums, maximums and mutually exclusive choices. |
| `MNU-008` | F1 | P0 | Operations management | UAT-menu | The system shall support meals, bundles and combos composed of configurable child selections. |
| `MNU-009` | F1 | P0 | Operations management | UAT-menu | Prices shall support tax treatment, channel pricing, scheduled pricing and approved branch exceptions controlled by head office. |
| `MNU-010` | F1 | P0 | Operations management | UAT-menu | Menu changes shall use draft, review, approval, scheduled publication and rollback states. |
| `MNU-011` | F1 | P0 | Operations management | UAT-menu | Every price, recipe and menu publication change shall retain version history and the approving user. |
| `MNU-012` | F1 | P0 | Operations management | T-06 | The menu service shall publish one consistent approved version to POS, customer app, call center and connected delivery platforms. |
| `MNU-013` | F1 | P0 | Operations management | T-06 | The platform shall detect and report channel menu-sync failures without blocking unaffected channels. |
| `MNU-014` | F3 | P0 | — | — | Recipes shall link sold products to ingredients, semi-finished items, packaging and expected quantities. |
| `MNU-015` | F1 | P0 | Operations management | UAT-menu | Recipe and price changes shall have effective dates so historical sales retain the values applicable when the order was placed. |
| `MNU-016` | F5 | P1 | — | — | Nutritional and allergen fields shall be available but content shall be published only when verified by an authorized owner. |

## NFR

_7.1 Nonfunctional requirements_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `NFR-001` | F1 | P0 | IT and system administration | T-01, SPIKE-offline-sync | The lab shall test sustained throughput above 200 orders per hour for one branch. |
| `NFR-002` | F1 | P0 | IT and system administration | T-01, SPIKE-offline-sync | Load tests shall include simultaneous orders from POS, call center, customer app and delivery-platform connectors. |
| `NFR-003` | F1 | P0 | IT and system administration | T-01, SPIKE-offline-sync | No accepted order may be lost or produce a duplicate business order under the approved load and recovery tests. |
| `NFR-004` | F1 | P0 | IT and system administration | T-04, SPIKE-payment-reconciliation | No confirmed payment may be attached to the wrong order or charged twice because of retry, timeout or reconnection. |
| `NFR-005` | F1 | P0 | IT and system administration | T-03, SPIKE-print-queue | Receipt and kitchen printing shall remain complete, ordered, observable and recoverable at the approved peak load. |
| `NFR-006` | F0 | P0 | — | — | The platform shall support horizontal or vertical capacity growth without changing core business identifiers or financial history. |
| `NFR-007` | F0 | P0 | — | — | The initial design shall support current multi-branch operations and future First Taste brands without a separate codebase per brand. |
| `NFR-008` | F1 | P0 | IT and system administration | SPIKE-offline-sync | Core cashier actions shall remain responsive under approved branch load, but robustness is the primary acceptance criterion. |
| `NFR-009` | F1 | P0 | IT and system administration | SPIKE-offline-sync | The system shall provide health, performance and error telemetry without recording unnecessary sensitive content. |
| `NFR-010` | F1 | P0 | IT and system administration | SPIKE-offline-sync | User-facing failures shall include a correlation reference that support can use without exposing secrets. |
| `NFR-011` | F0 | P0 | — | — | Deployments shall support controlled rollback and database changes shall use reversible or forward-compatible migration procedures. |
| `NFR-012` | F0 | P0 | — | — | The platform shall maintain automated unit, integration, contract, end-to-end, offline, load and security test suites. |
| `NFR-013` | F1 | P0 | IT and system administration | SPIKE-offline-sync | Accessibility, clear error states and touch targets suitable for cashier operation shall be included in UI acceptance. |
| `NFR-014` | F1 | P0 | IT and system administration | SPIKE-offline-sync | Date, time, currency, tax and numeric formats shall be correct for Saudi Arabia while remaining configurable. |
| `NFR-015` | F1 | P0 | IT and system administration | SPIKE-offline-sync | The system shall preserve time-zone-aware timestamps and a reliable sequence of events across branch and central services. |
| `NFR-016` | F1 | P0 | IT and system administration | T-02, SPIKE-offline-sync | Business continuity tests shall include internet loss, central outage, device restart, printer loss, payment uncertainty and delayed synchronization. |

## OFF

_5.8 Offline operation and synchronization_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `OFF-001` | F1 | P0 | IT and system administration | T-02, SPIKE-offline-sync | A branch shall remain fully operational when its connection to the central platform is unavailable. |
| `OFF-002` | F1 | P0 | IT and system administration | T-02, SPIKE-offline-sync | Offline operation shall include order entry, local menu access, cash handling, kitchen printing, barcode readiness and shift operations. |
| `OFF-003` | F1 | P0 | IT and system administration | T-02 | Operations that require an external online provider, including live card authorization, may follow provider-specific fallback rules but shall not corrupt local order state. |
| `OFF-004` | F1 | P0 | IT and system administration | T-02, SPIKE-offline-sync | Each branch device shall retain an encrypted local working set required for its assigned branch and role. |
| `OFF-005` | F1 | P0 | IT and system administration | T-02, SPIKE-offline-sync | Locally created events shall enter a durable outbox and synchronize automatically after connectivity returns. |
| `OFF-006` | F1 | P0 | IT and system administration | T-02, SPIKE-offline-sync | Synchronization shall be idempotent and shall prevent duplicate orders, payments, print jobs, invoices and stock movements. |
| `OFF-007` | F1 | P0 | IT and system administration | T-02, SPIKE-offline-sync | The system shall expose synchronization backlog, last successful sync, conflicts and failed events to authorized users. |
| `OFF-008` | F1 | P0 | IT and system administration | T-02, SPIKE-offline-sync | Conflict rules shall be deterministic and documented for menu versions, item availability, shifts, orders and payments. |
| `OFF-009` | F1 | P0 | IT and system administration | T-02, SPIKE-offline-sync | Financial and order events shall use append-only corrections rather than destructive overwrites during conflict resolution. |
| `OFF-010` | F1 | P0 | IT and system administration | T-03, SPIKE-print-queue | The branch shall continue printing while central services are unavailable. |
| `OFF-011` | F1 | P0 | IT and system administration | T-02, SPIKE-offline-sync | Once connected, ZATCA and management dashboards shall receive queued data automatically with visible completion status. |
| `OFF-012` | F1 | P0 | IT and system administration | SPIKE-lan-peer-sync, SPIKE-ios-durability | The preferred deployment shall avoid dedicated branch hardware, provided the approved reliability tests pass. |
| `OFF-013` | F1 | P0 | IT and system administration | SPIKE-lan-peer-sync, SPIKE-ios-durability | If iPad-only operation fails the lab acceptance criteria, the approved fallback shall be Windows POS or a small branch controller. |
| `OFF-014` | F1 | P0 | IT and system administration | SPIKE-lan-peer-sync, SPIKE-ios-durability | No hardware model shall be approved before concurrent printing, offline, recovery and load tests are passed in the HQ lab. |

## OMS

_5.5 Order management_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `OMS-001` | F1 | P0 | Operations management | T-01, SPIKE-offline-sync | The Order Management System shall receive orders from POS, customer app, website, call center, WhatsApp when enabled, company delivery and third-party delivery platforms. |
| `OMS-002` | F6 | P0 | — | — | Lazywait shall be fully replaced as the long-term order and POS platform. |
| `OMS-003` | F1 | P0 | Operations management | T-01 | The existing Spicy Meal customer app shall migrate fully to First Taste ERP services. |
| `OMS-004` | F2 | P0 | — | — | Third-party delivery platforms shall integrate directly with the ERP instead of relying on Deliverect as the target architecture. |
| `OMS-005` | F1 | P0 | Operations management | T-01, SPIKE-offline-sync | Each integration shall use idempotent order creation and preserve the original external order reference. |
| `OMS-006` | F1 | P0 | Operations management | T-01 | The OMS shall validate product, price, branch, service type and payment state before accepting an order. |
| `OMS-007` | F1 | P0 | Operations management | T-01 | The OMS shall provide a complete timeline of creation, validation, payment, routing, printing, preparation, readiness, delivery, completion, cancellation and refund events. |
| `OMS-008` | F1 | P0 | Operations management | T-01 | Failed orders shall enter an exception queue with failure reason, retry state, ownership and resolution history. |
| `OMS-009` | F1 | P0 | Operations management | T-01, SPIKE-offline-sync | Automatic retries shall use bounded schedules and shall never create a second business order or charge. |
| `OMS-010` | F1 | P0 | Operations management | T-01, SPIKE-offline-sync | Channel acknowledgement shall distinguish accepted, rejected, pending and unknown outcomes. |
| `OMS-011` | F1 | P0 | Operations management | T-04 | An unknown outcome shall be reconciled before the system retries an external create or payment request. |
| `OMS-012` | F1 | P0 | Operations management | T-01 | Orders shall be routed to the selected branch only after serviceability, opening hours and item availability checks. |
| `OMS-013` | F1 | P0 | Operations management | T-01 | The system shall support configurable minimum order values by brand, branch and order type. |
| `OMS-014` | F1 | P0 | Operations management | T-01, SPIKE-offline-sync | The system shall expose order status consistently to the POS, customer app, call center and management dashboard. |
| `OMS-015` | F1 | P0 | Operations management | T-01 | Authorized staff shall be able to search orders by internal ID, external ID, mobile number, date, branch, channel and payment reference. |
| `OMS-016` | F1 | P0 | Operations management | T-01 | The platform shall preserve the address, price, tax, recipe and customer snapshots applicable to an order after master data changes. |
| `OMS-017` | F2 | P1 | — | — | The platform shall support scheduled orders subject to configurable lead time and capacity rules. |
| `OMS-018` | F1 | P0 | Operations management | T-01, SPIKE-offline-sync | The system shall maintain one consolidated order view while protecting channel-specific credentials and data. |

## OPS

_5.24 Branch opening and closing_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `OPS-001` | F4 | P0 | — | — | The ERP shall provide configurable branch opening checklists. |
| `OPS-002` | F4 | P0 | — | — | The ERP shall provide configurable branch closing checklists. |
| `OPS-003` | F4 | P0 | — | — | Checklist items shall support role, schedule, required response, evidence, exception, corrective task and approval. |
| `OPS-004` | Future | P2 | — | — | Additional food-safety and inspection workflows are not committed in the current baseline and require separate approval. |

## PAY

_5.7 Payments cash refunds and ZATCA_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `PAY-001` | F1 | P0 | Finance and accounting | T-04 | The POS shall support cash, mada or card terminal, Apple Pay and contactless, online payment gateway, delivery-platform prepaid, split payment and customer wallet or store credit. |
| `PAY-002` | F1 | P0 | Finance and accounting | T-04 | Payment methods shall be configurable by company, brand, branch, channel and order type. |
| `PAY-003` | F1 | P0 | Finance and accounting | T-04 | The preferred mada flow shall send the exact amount to the terminal and receive the result automatically where the bank or provider supports integration. |
| `PAY-004` | F1 | P0 | Finance and accounting | T-04 | The POS shall provide a controlled manual terminal fallback when direct integration is unavailable. |
| `PAY-005` | F1 | P0 | Finance and accounting | T-04 | Each payment attempt shall have a unique idempotency key and an immutable link to its order. |
| `PAY-006` | F1 | P0 | Finance and accounting | T-04, SPIKE-payment-reconciliation | The system shall distinguish authorized, captured, declined, cancelled, refunded, partially refunded, pending and unknown payment outcomes. |
| `PAY-007` | F1 | P0 | Finance and accounting | T-04, SPIKE-payment-reconciliation | An unknown payment outcome shall be reconciled before another charge is attempted. |
| `PAY-008` | F1 | P0 | Finance and accounting | T-04 | Split payment shall preserve the amount, method, reference and refund balance of each component. |
| `PAY-009` | F1 | P0 | Finance and accounting | T-04 | Online-paid orders shall be submitted to fulfilment only after a verified payment state according to configured rules. |
| `PAY-010` | F1 | P0 | Finance and accounting | T-05, SPIKE-payment-reconciliation | Failed or cancelled online-paid orders shall be refunded automatically when predefined rules are met. |
| `PAY-011` | F1 | P0 | Finance and accounting | T-05, SPIKE-payment-reconciliation | Automatic refunds shall be idempotent and shall create alerts for pending, rejected or mismatched outcomes. |
| `PAY-012` | F1 | P0 | Finance and accounting | T-05 | Refund eligibility, amount limits and reasons shall be configurable by channel, payment method, order state and elapsed time. |
| `PAY-013` | F4 | P0 | — | — | The system shall automatically reconcile POS sales against bank, gateway and delivery-platform settlements and create exception alerts. |
| `PAY-014` | F4 | P0 | — | — | Settlement reconciliation shall account for commissions, fees, refunds, chargebacks, withholding and timing differences. |
| `PAY-015` | F5 | P0 | — | — | Customer wallet and store-credit balances shall use a controlled ledger and shall never be edited by overwriting the balance. |
| `PAY-016` | F1 | P0 | Finance and accounting | T-09 | The system shall generate and retain ZATCA-compliant invoices, credit notes and debit notes according to the rules applicable at implementation time. |
| `PAY-017` | F1 | P0 | Finance and accounting | T-09 | ZATCA submission or reporting that cannot complete during an outage shall be queued securely and synchronized when connectivity returns. |
| `PAY-018` | F1 | P0 | Finance and accounting | T-09 | ZATCA identifiers, invoice counters, hashes, certificates and submission responses shall be protected from unauthorized alteration. |
| `PAY-019` | F1 | P0 | Finance and accounting | T-09 | ZATCA requirements shall be validated against the current official specifications before certification and production release. |

## POS

_5.3 Point of sale_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `POS-001` | F1 | P0 | Operations management | UAT-cashier | The POS shall support walk-in takeaway orders. |
| `POS-002` | F1 | P0 | Operations management | UAT-cashier | The POS and order platform shall support customer pickup orders placed through digital channels. |
| `POS-003` | F1 | P0 | Operations management | UAT-cashier | The platform shall support Spicy Meal delivery orders handled by company drivers. |
| `POS-004` | F1 | P0 | Operations management | UAT-cashier | The platform shall support prepaid and cash-on-delivery orders received from third-party delivery platforms where the platform permits them. |
| `POS-005` | F1 | P0 | Operations management | UAT-cashier | The platform shall support call-center order entry and tracking. |
| `POS-006` | F1 | P0 | Operations management | UAT-cashier | The platform shall support dine-in and table-service orders, including configurable table identifiers. |
| `POS-007` | F1 | P0 | Operations management | UAT-cashier | The cashier interface shall retain familiar Lazywait interaction patterns where useful while correcting identified limitations. |
| `POS-008` | F1 | P0 | Operations management | SPIKE-offline-sync, SPIKE-lan-peer-sync, SPIKE-ios-durability | Operational correctness, transaction integrity and recoverability shall take priority over minimizing order-entry seconds. |
| `POS-009` | F1 | P0 | Operations management | T-01, SPIKE-offline-sync | A branch shall support at least three simultaneously active cashier or order-entry devices. |
| `POS-010` | F1 | P0 | Operations management | T-01, SPIKE-offline-sync | The POS shall maintain one authoritative order record regardless of which device or channel created it. |
| `POS-011` | F1 | P0 | Operations management | T-01, SPIKE-offline-sync | The POS shall prevent duplicate submission caused by repeated taps, retries, delayed responses or reconnection. |
| `POS-012` | F1 | P0 | Operations management | T-01, SPIKE-offline-sync | Each order shall have an immutable internal identifier and channel-specific external references where applicable. |
| `POS-013` | F1 | P0 | Operations management | UAT-cashier | The cashier shall be able to add products, modifiers, notes, quantities and customer details according to permissions. |
| `POS-014` | F1 | P0 | Operations management | UAT-cashier | The cashier shall be able to edit an open order before payment while the system records material changes. |
| `POS-015` | F1 | P0 | Operations management | T-10 | Post-payment edits, voids, discounts and refunds shall follow role-based privilege and approval rules. |
| `POS-016` | F1 | P0 | Operations management | UAT-cashier | The POS shall support configurable discounts, promotions, coupons, employee discounts and manager overrides. |
| `POS-017` | F1 | P0 | Operations management | UAT-cashier | The POS shall show the source channel and payment state clearly on every order. |
| `POS-018` | F1 | P0 | Operations management | UAT-cashier | The POS shall display print state, kitchen state, payment state and synchronization state without requiring technical access. |
| `POS-019` | F1 | P0 | Operations management | UAT-cashier | The POS shall support reprinting with a visible reprint label, reason and user audit record. |
| `POS-020` | F1 | P0 | Operations management | UAT-cashier | The POS shall use the basic order lifecycle Received, Preparing, Ready and Completed. |
| `POS-021` | F1 | P0 | Operations management | UAT-cashier | Authorized users shall be able to cancel orders or items using configured reason codes. |
| `POS-022` | F1 | P0 | Operations management | T-08, SPIKE-shift-conflict | A cashier account shall be able to operate from multiple authorized terminals without creating separate cash ownership records for each device. |
| `POS-023` | F1 | P0 | Operations management | T-08, SPIKE-shift-conflict | Cash responsibility shall remain attached to the cashier shift even when the cashier uses multiple terminals. |
| `POS-024` | F1 | P0 | Operations management | T-08, SPIKE-shift-conflict | Shift closing shall use a blind count so the cashier cannot view the expected cash before submitting the physical count. |
| `POS-025` | F1 | P0 | Operations management | T-08, SPIKE-shift-conflict | Cash differences shall be calculated automatically and routed according to configured tolerance and approval rules. |
| `POS-026` | F1 | P0 | Operations management | T-08, SPIKE-shift-conflict | The POS shall support branch, terminal, cashier and shift opening and closing records. |
| `POS-027` | F1 | P0 | Operations management | UAT-cashier | The POS shall support Arabic and English with correct right-to-left and left-to-right layouts. |
| `POS-028` | F1 | P0 | Operations management | UAT-cashier | The POS shall preserve complete transaction history and shall not physically delete posted financial transactions. |
| `POS-029` | F1 | P1 | — | — | The POS shall support a training mode isolated from production financial, stock and ZATCA records. |
| `POS-030` | F1 | P0 | Operations management | UAT-cashier | The POS shall provide clear operator guidance for recoverable failures instead of generic error messages. |

## PRC

_5.13 Procurement and suppliers_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `PRC-001` | F3 | P0 | — | — | The system shall support purchase requests, requests for quotation, supplier quotations, evaluation, purchase orders, receiving and invoice matching. |
| `PRC-002` | F3 | P0 | — | — | Purchase approvals shall use configurable rules based on amount, department, item type, facility, budget and requester role. |
| `PRC-003` | F3 | P0 | — | — | Approval rules shall support multiple levels, delegation, substitute approvers and escalation for overdue decisions. |
| `PRC-004` | F3 | P0 | — | — | The system shall prevent the requester from approving a transaction where segregation-of-duties rules prohibit it. |
| `PRC-005` | F3 | P0 | — | — | Supplier records shall include commercial, tax, contact, banking, category, contract and performance information subject to access controls. |
| `PRC-006` | F3 | P0 | — | — | Receiving shall support partial delivery, rejected quantities, batch and expiry capture, and evidence attachments. |
| `PRC-007` | F4 | P0 | — | — | The system shall perform configurable two-way or three-way matching before supplier invoice approval. |
| `PRC-008` | F4 | P1 | — | — | Supplier performance shall be measurable by price, quality, lead time, fulfilment and disputes. |
| `PRC-009` | F4 | P0 | — | — | Purchasing commitments shall be visible against approved budgets before final approval. |

## PRG

_5.1 Program foundation_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `PRG-001` | F0 | P0 | — | — | The product shall be a First Taste Company platform, with Spicy Meal configured as the first brand and first implementation. |
| `PRG-002` | F0 | P0 | — | — | The platform shall support the hierarchy company, legal entity, brand, operating unit, branch or facility, department, cost center, sales channel and device. |
| `PRG-003` | F0 | P0 | — | — | The first implementation shall operate one legal company while preserving a data model that can add legal entities later without redesign. |
| `PRG-004` | F0 | P0 | — | — | Cross-brand sharing shall be configurable separately for each data domain, including customers, loyalty, employees, suppliers, products and financial dimensions. |
| `PRG-005` | F0 | P1 | — | — | The system shall be designed primarily for internal First Taste use; future licensing to other restaurant companies shall remain possible but shall not drive the initial scope. |
| `PRG-006` | F0 | P0 | — | — | First Taste shall own all custom source code, databases, configurations, documentation and business logic produced for the program. |
| `PRG-007` | F0 | P0 | — | — | Open-source and commercial dependencies shall be documented with their licenses, replacement options and operational ownership. |
| `PRG-008` | F0 | P0 | — | — | The implementation shall use AI-assisted development led through the Product Owner, with source control, code review, automated testing and documented releases. |
| `PRG-009` | F0 | P0 | — | — | Repository organization shall be selected after the architecture design and shall support independent deployment where operational risk requires it. |
| `PRG-010` | F0 | P0 | — | — | Architecture and hosting proposals shall include tiered cost options before a final infrastructure commitment is made. |
| `PRG-011` | F0 | P0 | — | — | The central hosting model shall remain undecided until the architecture, Saudi data requirements, reliability and cost study are completed. |
| `PRG-012` | F0 | P0 | — | — | Recovery-point and recovery-time objectives shall be selected from costed tiers and approved by executive management. |
| `PRG-013` | F5 | P1 | — | — | Historical data migration shall be treated as a separate assessed workstream; no migration scope is approved at this stage. |
| `PRG-014` | F0 | P0 | — | — | The requirements and user interfaces shall be maintained in Arabic and English. |
| `PRG-015` | F0 | P0 | — | — | Any difference between the English and Arabic requirements shall be escalated to the Product Owner for a binding clarification. |

## PRN

_5.6 Kitchen printing and barcode readiness_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `PRN-001` | F1 | P0 | IT and system administration | T-07, SPIKE-print-queue, UAT-kitchen | Printed cashier receipts and printed kitchen slips shall be the production interfaces required in the first release. |
| `PRN-002` | F1 | P0 | IT and system administration | T-03, SPIKE-print-queue | The branch print subsystem shall accept simultaneous orders from cashiers, call center, customer app and delivery platforms without losing or duplicating jobs. |
| `PRN-003` | F1 | P0 | IT and system administration | T-03, SPIKE-print-queue | Every print job shall have a persistent unique identifier linked to the order and document type. |
| `PRN-004` | F1 | P0 | IT and system administration | T-03, SPIKE-print-queue | Print jobs shall be queued durably and survive application restart, device restart and temporary network failure. |
| `PRN-005` | F1 | P0 | IT and system administration | T-03, SPIKE-print-queue | The POS shall display queued, printing, printed, failed, retrying and reprinted states. |
| `PRN-006` | F1 | P0 | IT and system administration | T-03, SPIKE-print-queue, UAT-kitchen | Order changes and cancellations shall print clearly and shall reference the original order and affected items. |
| `PRN-007` | F1 | P0 | IT and system administration | T-07, SPIKE-print-queue, UAT-kitchen | A kitchen slip shall contain a unique machine-readable barcode associated with the correct order. |
| `PRN-008` | F1 | P0 | IT and system administration | T-07, SPIKE-print-queue, UAT-kitchen | Scanning the approved kitchen barcode shall move the order to Ready, subject to authorization and duplicate-scan protection. |
| `PRN-009` | F1 | P0 | IT and system administration | T-07, SPIKE-print-queue, UAT-kitchen | The first workflow shall treat a barcode scan as readiness for the full order; station-level or partial readiness remains a future design decision. |
| `PRN-010` | F1 | P0 | IT and system administration | T-07, SPIKE-print-queue, UAT-kitchen | Receipt and kitchen templates shall support Arabic and English, channel, order type, modifiers, notes, timestamps and order identifiers. |
| `PRN-011` | F1 | P1 | — | — | The print subsystem shall prevent a successful printer acknowledgement from being treated as proof that the kitchen received an unreadable or incomplete document. |
| `PRN-012` | F1 | P0 | IT and system administration | T-03, SPIKE-print-queue | Authorized users shall be able to retry failed jobs and route them to a configured fallback printer where supported. |
| `PRN-013` | F1 | P0 | IT and system administration | T-03, SPIKE-print-queue | Printing shall continue during central internet outage for orders available within the branch offline environment. |
| `PRN-014` | F1 | P0 | IT and system administration | SPIKE-lan-peer-sync, SPIKE-ios-durability | The lab shall compare iPad-native printing, Windows printing and an optional controller before production hardware is approved. |
| `PRN-015` | Future | P2 | — | — | Kitchen Display System functionality is not required for the initial production workflow unless later approved. |

## REL

_8.1 Lab and release requirements_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `REL-001` | F2 | P0 | — | — | The ERP shall remain outside production until stable end-to-end operation is demonstrated and owner or executive management approves production use. |
| `REL-002` | F2 | P0 | — | — | Existing branches shall remain on Lazywait through 31 December 2027 under the current contract. |
| `REL-003` | F2 | P0 | — | — | Owner or executive management shall be the final production sign-off authority. |
| `REL-004` | F1 | P0 | Product Owner | UAT-release-gate | The first complete HQ lab milestone shall be delivered within nine months of approved project kickoff and shall cover POS, menu and order management with their essential platform dependencies. |
| `REL-005` | F2 | P0 | — | — | After executive approval and before 1 January 2028, eligible newly opened branches may use the ERP under a controlled rollout plan. |
| `REL-006` | F6 | P0 | — | — | Replacement of Lazywait for existing branches is targeted from 1 January 2028, with exact sequencing approved in the cutover plan. |

## RPT

_5.21 Reporting and analytics_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `RPT-001` | F1 | P0 | Finance and accounting | UAT-reporting | The ERP shall provide standard operational, sales, financial, inventory, factory, HR, delivery and service reports. |
| `RPT-002` | F4 | P0 | — | — | Authorized users shall be able to build custom reports and dashboards from governed data fields. |
| `RPT-003` | F1 | P0 | Finance and accounting | UAT-reporting | Reports shall support Excel and PDF export while respecting user permissions and data masking. |
| `RPT-004` | F4 | P0 | — | — | Reports shall support scheduled delivery through approved email, employee-app or dashboard channels. |
| `RPT-005` | F5 | P0 | — | — | Authorized users shall be able to ask natural-language questions through AI and receive answers linked to source measures. |
| `RPT-006` | F1 | P0 | Finance and accounting | UAT-reporting | Dashboards shall expose data freshness, filters, definitions and drill-down paths. |
| `RPT-007` | F4 | P0 | — | — | Performance shall be reportable by company, brand, branch, channel, department or cost center, product, factory and warehouse. |
| `RPT-008` | F1 | P0 | Finance and accounting | UAT-reporting | Core sales reporting shall include net sales, orders, average order value, item mix, discounts, refunds, tax, payment method and hourly demand. |
| `RPT-009` | F1 | P0 | Finance and accounting | UAT-reporting | Operational reporting shall include preparation time, readiness time, completion time, printing failures, synchronization backlog and order exceptions. |
| `RPT-010` | F3 | P0 | — | — | Inventory reporting shall include on-hand, committed, available, expiring, theoretical use, actual use, variance, waste and stockout risk. |
| `RPT-011` | F0 | P0 | — | — | All key performance indicators shall have approved definitions, owners, source fields and calculation rules. |
| `RPT-012` | F5 | P0 | — | — | A report shall not present AI inference as a verified accounting or operational fact without clear labeling. |

## SEC

_7.2 Security and privacy_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `SEC-001` | F0 | P0 | — | — | Security and privacy shall be designed into every module rather than added after implementation. |
| `SEC-002` | F0 | P0 | — | — | Data shall be encrypted in transit and sensitive data shall be encrypted at rest using managed keys and approved controls. |
| `SEC-003` | F0 | P0 | — | — | Secrets, payment credentials, API tokens, certificates and private keys shall be stored outside source code and rotated through controlled procedures. |
| `SEC-004` | F0 | P0 | — | — | The system shall apply least privilege, segregation of duties and periodic access review. |
| `SEC-005` | F0 | P0 | — | — | Sensitive personal, payroll, payment and financial fields shall support masking and restricted export. |
| `SEC-006` | F0 | P0 | — | — | Audit logs shall record actor, action, target, before and after values where appropriate, time, device, source and outcome. |
| `SEC-007` | F0 | P0 | — | — | Audit-log access and retention shall be restricted, monitored and protected from routine alteration. |
| `SEC-008` | F0 | P0 | — | — | The platform shall support retention schedules and approved deletion or anonymization workflows by data category. |
| `SEC-009` | F0 | P0 | — | — | Customer and employee personal data processing shall be assessed against applicable Saudi personal-data requirements before production. |
| `SEC-010` | F1 | P0 | IT and system administration | T-10 | Third-party integrations shall use scoped credentials, request validation, timeout, retry, rate-limit and circuit-breaker controls. |
| `SEC-011` | F1 | P0 | IT and system administration | T-10 | Incoming webhooks shall be authenticated where supported and protected against replay. |
| `SEC-012` | F0 | P0 | — | — | Production data shall not be copied into development or testing without approved masking and handling controls. |
| `SEC-013` | F0 | P0 | — | — | Backups shall be encrypted, tested through restore exercises and isolated from ordinary application credentials. |
| `SEC-014` | F0 | P0 | — | — | Security incidents shall use documented detection, containment, recovery, evidence and notification procedures. |
| `SEC-015` | F2 | P0 | — | — | The production release shall complete vulnerability assessment, dependency review and penetration testing appropriate to the risk. |

## SUP

_5.23 Support monitoring and notifications_

| ID | Phase | Pri | Owner | Tests | Requirement |
|---|---|---|---|---|---|
| `SUP-001` | F2 | P0 | — | — | First-line support shall be provided by an AI support assistant, with escalation to First Taste IT. |
| `SUP-002` | F2 | P0 | — | — | The AI support assistant shall use approved troubleshooting procedures and shall not perform risky changes without authorization. |
| `SUP-003` | F2 | P0 | — | — | Support cases shall include branch, device, user, time, symptoms, logs, business impact, actions and resolution. |
| `SUP-004` | F1 | P0 | IT and system administration | UAT-support | Central monitoring shall cover POS application health, devices, printers, print queues, connectivity, synchronization, payments and external integrations. |
| `SUP-005` | F1 | P0 | IT and system administration | UAT-support | Monitoring shall create automatic alerts with severity, ownership, deduplication and escalation. |
| `SUP-006` | F1 | P0 | IT and system administration | UAT-support | Alerts and approvals shall be deliverable through the management dashboard, employee-app push, email, WhatsApp and in-POS messages. |
| `SUP-007` | F1 | P0 | IT and system administration | UAT-support | Notification content and recipient rules shall prevent sensitive information from being disclosed through an inappropriate channel. |
| `SUP-008` | F1 | P0 | IT and system administration | UAT-support | The system shall provide branch and integration health dashboards with last-seen and last-successful-transaction information. |
| `SUP-009` | F1 | P0 | IT and system administration | UAT-support | Operational runbooks shall cover internet outage, printer failure, terminal failure, payment uncertainty, sync backlog, ZATCA queue, data restore and security incident. |
