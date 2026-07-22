# Cloud Engineering Internship Projects

This repository contains the source code for two cloud-based full-stack applications built during my internship.

---

## 📁 1. CloudVault — Secure Cloud File Storage System

CloudVault is a secure cloud storage web application inspired by Google Drive, capable of storing files, managing directory architectures, and keeping track of histories.

### Key Features
* **Dual Storage Driver Engine:** Integrates with AWS S3 using Boto3 (when credentials are set in the environment) and falls back to a secure local folder storage system for zero-dependency local runs.
* **JWT-Based Authentication:** Clean sign-up and login layouts utilizing password hashing and secure JSON Web Tokens.
* **File & Folder Management:** Drag-and-drop file uploading, directory mapping (creating subfolders), renaming, and deletion.
* **Automated Versioning System:** Uploading a file with an identical name in a directory archives the older copy as a history trace. Users can check versions and restore past edits in one click.
* **Sharing Links:** Generate expiring download URLs (S3 presigned URLs or secure local download endpoints).
* **Glassmorphic Theme:** Responsive UI designed with custom animations, storage metrics, and dynamic grid layouts.

---

## 📊 2. CloudCost Optimizer — FinOps & Cloud Cost Optimization Dashboard

CloudCost Optimizer is a FinOps dashboard built to monitor cloud resources, identify cost leaks, manage budgets, and optimize resource sizes to reduce waste.

### Key Features
* **AWS Cost Explorer Telemetry Simulator:** Generates monthly telemetry figures broken down by AWS service types (EC2, S3, RDS, Redshift) and regions.
* **Cost Leaks Recommendations Engine:** Identifies active billing leaks:
  * Underutilized EC2 instances (runs low CPU workload on oversized machines).
  * Stopped/Idle EC2 instances.
  * Unattached orphaned EBS volumes.
  * Idle Elastic Load Balancers receiving zero traffic.
  * Standard S3 buckets missing transition Lifecycle policies.
* **Actionable One-Click Optimization:** Pressing "Optimize" sends a request to clean up that resource, immediately recalculating monthly stats, redrawing charts, and reducing spend totals.
* **Interactive Visualizations:** Live line graphs tracking monthly cost trends and service share pie-charts powered by Chart.js.
* **Budget Threshold Alerts:** Allows setting custom spending limits. Automatically sends warning logs (at 85%) and critical alerts (at 100%) if forecasted spend exceeds thresholds.

---

## 🛠️ Technology Stack
* **Frontend:** HTML5, CSS3 (variables, transitions, responsive layouts), Vanilla ES6 JavaScript, Chart.js.
* **Backend:** Python 3, Flask, Flask-CORS.
* **Database:** SQLite.
* **Cloud & Tools:** Boto3, Git.

---

## 🚀 How to Run Locally

### Prerequisites
Make sure you have **Python 3.x** installed.

### Run CloudVault (File Storage)
1. Install dependencies:
   ```bash
   pip install -r file-storage-system/server/requirements.txt
   ```
2. Run backend server:
   ```bash
   python file-storage-system/server/app.py
   ```
3. Open `file-storage-system/client/auth.html` in your browser.

### Run CloudCost Optimizer (FinOps Dashboard)
1. Install dependencies:
   ```bash
   pip install -r cloud-cost-dashboard/server/requirements.txt
   ```
2. Run backend server:
   ```bash
   python cloud-cost-dashboard/server/app.py
   ```
3. Open `cloud-cost-dashboard/client/index.html` in your browser.
