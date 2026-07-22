import os
from datetime import datetime
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# In-Memory AWS Infrastructure Simulator State
state = {
    "budget": 2000.0,
    "alerts": [
        {
            "id": 1,
            "timestamp": "2026-07-20 09:30:15",
            "message": "Budget Alert! Current forecasted spend ($2254.00) exceeds 100% of your budget limit ($2000.00).",
            "severity": "critical"
        },
        {
            "id": 2,
            "timestamp": "2026-07-15 14:10:00",
            "message": "Warning: Monthly spend has reached 85% of budget threshold.",
            "severity": "warning"
        }
    ],
    # Simulated Resources with cost leaks
    "resources": {
        "ec2": [
            {
                "id": "i-0fa7c91823bcda9a1",
                "name": "prod-data-cruncher",
                "type": "t3.xlarge",
                "region": "us-east-1",
                "status": "running",
                "cost": 136.80,
                "cpu": 2.1,
                "state": "Underutilized",
                "saving": 96.00,
                "action": "Downsize to t3.medium"
            },
            {
                "id": "i-0ab4d193f3c3ba98c",
                "name": "dev-sandbox-test",
                "type": "c5.2xlarge",
                "region": "us-west-2",
                "status": "running",
                "cost": 274.50,
                "cpu": 0.4,
                "state": "Idle",
                "saving": 274.50,
                "action": "Stop Instance"
            },
            {
                "id": "i-09f1a2384a2cfcb44",
                "name": "production-api-web",
                "type": "m5.xlarge",
                "region": "eu-central-1",
                "status": "running",
                "cost": 144.00,
                "cpu": 65.4,
                "state": "Optimized",
                "saving": 0.0,
                "action": None
            }
        ],
        "ebs": [
            {
                "id": "vol-090cfa3bcfa51e9b1",
                "name": "orphaned-backup-db",
                "size": "500 GB GP3",
                "region": "us-east-1",
                "status": "available", # 'available' in AWS means unattached!
                "cost": 40.00,
                "state": "Unattached",
                "saving": 40.00,
                "action": "Delete Volume"
            },
            {
                "id": "vol-03ab9cd501235cb1a",
                "name": "api-web-root",
                "size": "100 GB GP3",
                "region": "eu-central-1",
                "status": "in-use",
                "cost": 8.00,
                "state": "Optimized",
                "saving": 0.0,
                "action": None
            }
        ],
        "elb": [
            {
                "id": "dev-testing-alb",
                "name": "dev-testing-alb",
                "type": "Application",
                "region": "us-west-2",
                "status": "active",
                "requests": 0,
                "cost": 22.26,
                "state": "Idle (No Traffic)",
                "saving": 22.26,
                "action": "Delete Balancer"
            },
            {
                "id": "prod-main-alb",
                "name": "prod-main-alb",
                "type": "Application",
                "region": "us-east-1",
                "status": "active",
                "requests": 1489000,
                "cost": 34.50,
                "state": "Optimized",
                "saving": 0.0,
                "action": None
            }
        ],
        "s3": [
            {
                "id": "logs-archive-dump",
                "name": "logs-archive-dump",
                "size": "6.8 TB",
                "region": "us-east-1",
                "status": "active",
                "cost": 156.40,
                "state": "Standard Class (Old Logs)",
                "saving": 94.00,
                "action": "Enable Lifecycle Glacier Rule"
            }
        ]
    },
    # Base monthly constant services costs (RDS, Redshift, CloudFront) that are fixed
    "fixed_costs": {
        "RDS Databases": 320.00,
        "Amazon Redshift": 480.00,
        "Amazon CloudFront CDN": 65.50,
        "DynamoDB Storage": 45.00
    },
    # Historical spending logs (Feb - July 2026)
    "historical": [
        {"month": "Feb", "EC2": 450, "S3": 110, "RDS": 320, "Redshift": 480, "Others": 105},
        {"month": "Mar", "EC2": 490, "S3": 125, "RDS": 320, "Redshift": 480, "Others": 112},
        {"month": "Apr", "EC2": 420, "S3": 130, "RDS": 320, "Redshift": 480, "Others": 98},
        {"month": "May", "EC2": 520, "S3": 145, "RDS": 320, "Redshift": 480, "Others": 120},
        {"month": "Jun", "EC2": 560, "S3": 150, "RDS": 320, "Redshift": 480, "Others": 135},
        {"month": "Jul", "EC2": 555, "S3": 156, "RDS": 320, "Redshift": 480, "Others": 110} # July cost current
    ]
}

# Calculated statistics based on state
def compute_metrics():
    # 1. Sum up resource costs
    active_resource_cost = 0.0
    potential_savings = 0.0
    
    # Recommendations list helper
    recommendations = []
    
    for category, items in state["resources"].items():
        for item in items:
            if item.get("status") in ["running", "available", "active"]:
                active_resource_cost += item["cost"]
                if item["saving"] > 0:
                    potential_savings += item["saving"]
                    recommendations.append({
                        "category": category.upper(),
                        "id": item["id"],
                        "name": item["name"],
                        "region": item["region"],
                        "cost": item["cost"],
                        "state": item["state"],
                        "saving": item["saving"],
                        "action": item["action"]
                    })
            elif category == "s3": # S3 buckets are always active
                active_resource_cost += item["cost"]
                if item["saving"] > 0:
                    potential_savings += item["saving"]
                    recommendations.append({
                        "category": category.upper(),
                        "id": item["id"],
                        "name": item["name"],
                        "region": item["region"],
                        "cost": item["cost"],
                        "state": item["state"],
                        "saving": item["saving"],
                        "action": item["action"]
                    })

    # 2. Add fixed costs
    fixed_total = sum(state["fixed_costs"].values())
    current_spend = active_resource_cost + fixed_total
    
    # 3. Forecasted is current + 10% inflation/usage forecast
    forecasted_spend = current_spend * 1.12
    
    # Service breakdowns
    service_share = {
        "EC2 Instances": active_resource_cost * 0.6, # EC2 proportional
        "S3 Storage": state["resources"]["s3"][0]["cost"] if state["resources"]["s3"][0]["status"] == "active" else 0,
        "RDS Databases": state["fixed_costs"]["RDS Databases"],
        "Redshift Clusters": state["fixed_costs"]["Amazon Redshift"],
        "CloudFront & Others": state["fixed_costs"]["Amazon CloudFront CDN"] + state["fixed_costs"]["DynamoDB Storage"] + (active_resource_cost * 0.1)
    }
    
    # Regional breakdowns
    regional_share = {
        "us-east-1 (N. Virginia)": current_spend * 0.55,
        "us-west-2 (Oregon)": current_spend * 0.25,
        "eu-central-1 (Frankfurt)": current_spend * 0.20
    }
    
    return {
        "budget": state["budget"],
        "current_spend": round(current_spend, 2),
        "forecasted_spend": round(forecasted_spend, 2),
        "potential_savings": round(potential_savings, 2),
        "alerts_count": len(state["alerts"]),
        "alerts": state["alerts"],
        "recommendations": recommendations,
        "service_share": {k: round(v, 2) for k, v in service_share.items()},
        "regional_share": {k: round(v, 2) for k, v in regional_share.items()},
        "historical": state["historical"]
    }

# Check budget alerts dynamically
def check_budget_alerts():
    metrics = compute_metrics()
    current_spend = metrics["current_spend"]
    budget = state["budget"]
    
    # Remove existing critical alerts to re-evaluate
    state["alerts"] = [a for a in state["alerts"] if "Budget Alert!" not in a["message"]]
    
    if current_spend > budget:
        state["alerts"].insert(0, {
            "id": int(datetime.now().timestamp()),
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "message": f"Budget Alert! Current spend (${current_spend:.2f}) has exceeded 100% of your budget limit (${budget:.2f}).",
            "severity": "critical"
        })
    elif current_spend > (budget * 0.85):
        # Check if warning already exists
        exists = any("85% of budget" in a["message"] for a in state["alerts"])
        if not exists:
            state["alerts"].insert(0, {
                "id": int(datetime.now().timestamp()),
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "message": f"Warning: Monthly spend (${current_spend:.2f}) has reached 85% of budget threshold (${budget:.2f}).",
                "severity": "warning"
            })

# --- API ROUTES ---

@app.route('/api/costs/dashboard', methods=['GET'])
def get_dashboard():
    check_budget_alerts()
    return jsonify(compute_metrics())

@app.route('/api/costs/budget', methods=['POST'])
def update_budget():
    data = request.json
    new_budget = data.get('budget')
    if new_budget is None:
        return jsonify({'message': 'Budget value is required'}), 400
        
    state["budget"] = float(new_budget)
    check_budget_alerts()
    return jsonify({'message': 'Budget updated successfully', 'budget': state["budget"], 'alerts': state["alerts"]})

@app.route('/api/costs/optimize', methods=['POST'])
def optimize_resource():
    data = request.json
    category = data.get('category').lower() # 'ec2', 'ebs', 'elb', 's3'
    resource_id = data.get('id')
    
    if not category or not resource_id:
        return jsonify({'message': 'Category and Resource ID are required'}), 400
        
    if category not in state["resources"]:
        return jsonify({'message': f'Invalid category: {category}'}), 400
        
    items = state["resources"][category]
    found = False
    
    for item in items:
        if item["id"] == resource_id:
            # Action mapping
            action = item.get("action")
            if not action:
                return jsonify({'message': 'Resource is already optimized'}), 400
                
            found = True
            
            # Apply cost optimization simulation:
            if category == "ec2":
                if "Downsize" in action:
                    item["type"] = "t3.medium"
                    item["cost"] = item["cost"] - item["saving"]
                    item["cpu"] = 18.5 # CPU utilization increases since container is smaller
                    item["state"] = "Optimized (Downsized)"
                    item["saving"] = 0.0
                    item["action"] = None
                elif "Stop" in action:
                    item["status"] = "stopped"
                    item["cost"] = 0.0 # Idle instance stopped: cost drops to 0
                    item["state"] = "Stopped"
                    item["saving"] = 0.0
                    item["action"] = None
            elif category == "ebs":
                item["status"] = "deleted"
                item["cost"] = 0.0
                item["state"] = "Deleted"
                item["saving"] = 0.0
                item["action"] = None
            elif category == "elb":
                item["status"] = "deleted"
                item["cost"] = 0.0
                item["state"] = "Deleted"
                item["saving"] = 0.0
                item["action"] = None
            elif category == "s3":
                # Enable Lifecycle Glacier: cost drops by savings
                item["cost"] = item["cost"] - item["saving"]
                item["state"] = "Optimized (Glacier Rules Enabled)"
                item["saving"] = 0.0
                item["action"] = None
                
            break
            
    if not found:
        return jsonify({'message': 'Resource not found'}), 404
        
    check_budget_alerts()
    return jsonify({
        'message': 'Resource optimized successfully', 
        'metrics': compute_metrics()
    })

@app.route('/api/costs/reset', methods=['POST'])
def reset_simulation():
    # Reset simulation resources back to initial leak states
    state["budget"] = 2000.0
    state["alerts"] = [
        {
            "id": 1,
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "message": "Budget Alert! Current forecasted spend ($2254.00) exceeds 100% of your budget limit ($2000.00).",
            "severity": "critical"
        }
    ]
    state["resources"]["ec2"][0] = {
        "id": "i-0fa7c91823bcda9a1",
        "name": "prod-data-cruncher",
        "type": "t3.xlarge",
        "region": "us-east-1",
        "status": "running",
        "cost": 136.80,
        "cpu": 2.1,
        "state": "Underutilized",
        "saving": 96.00,
        "action": "Downsize to t3.medium"
    }
    state["resources"]["ec2"][1] = {
        "id": "i-0ab4d193f3c3ba98c",
        "name": "dev-sandbox-test",
        "type": "c5.2xlarge",
        "region": "us-west-2",
        "status": "running",
        "cost": 274.50,
        "cpu": 0.4,
        "state": "Idle",
        "saving": 274.50,
        "action": "Stop Instance"
    }
    state["resources"]["ebs"][0] = {
        "id": "vol-090cfa3bcfa51e9b1",
        "name": "orphaned-backup-db",
        "size": "500 GB GP3",
        "region": "us-east-1",
        "status": "available",
        "cost": 40.00,
        "state": "Unattached",
        "saving": 40.00,
        "action": "Delete Volume"
    }
    state["resources"]["elb"][0] = {
        "id": "dev-testing-alb",
        "name": "dev-testing-alb",
        "type": "Application",
        "region": "us-west-2",
        "status": "active",
        "requests": 0,
        "cost": 22.26,
        "state": "Idle (No Traffic)",
        "saving": 22.26,
        "action": "Delete Balancer"
    }
    state["resources"]["s3"][0] = {
        "id": "logs-archive-dump",
        "name": "logs-archive-dump",
        "size": "6.8 TB",
        "region": "us-east-1",
        "status": "active",
        "cost": 156.40,
        "state": "Standard Class (Old Logs)",
        "saving": 94.00,
        "action": "Enable Lifecycle Glacier Rule"
    }
    check_budget_alerts()
    return jsonify({'message': 'Simulation state reset successfully'})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)
