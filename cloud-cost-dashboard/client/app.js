const API_URL = 'http://localhost:5001/api';

// Global Chart References
let trendChartInstance = null;
let serviceChartInstance = null;

// On Initial Load
document.addEventListener('DOMContentLoaded', () => {
    fetchDashboardData();
});

async function fetchDashboardData() {
    try {
        const response = await fetch(`${API_URL}/costs/dashboard`);
        if (!response.ok) throw new Error('Failed to retrieve dashboard data');
        
        const data = await response.json();
        
        updateKPIs(data);
        renderCharts(data);
        renderAlerts(data.alerts);
        renderRecommendations(data.recommendations);
        updateBudgetStatus(data.current_spend, data.budget);
        
    } catch (e) {
        console.error('Error fetching dashboard data:', e);
    }
}

function updateKPIs(data) {
    document.getElementById('kpi-current-spend').innerText = `$${data.current_spend.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    document.getElementById('kpi-forecasted-spend').innerText = `$${data.forecasted_spend.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    document.getElementById('kpi-savings-potential').innerText = `$${data.potential_savings.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    document.getElementById('kpi-alerts-count').innerText = data.alerts_count;
    
    // Set budget input field value once
    const budgetInput = document.getElementById('budget-input');
    if (!budgetInput.value) {
        budgetInput.value = data.budget;
    }
}

function updateBudgetStatus(current, limit) {
    const percentage = Math.min((current / limit) * 100, 100);
    const label = document.getElementById('budget-status-label');
    
    label.innerText = `Budget utilization: ${percentage.toFixed(1)}% ($${current.toFixed(2)} of $${limit.toFixed(2)})`;
    
    // Alert styling if close to or over budget
    const kpiAlertsCard = document.querySelector('.kpi-card.alerts');
    if (current > limit) {
        label.style.color = 'var(--accent-red)';
        kpiAlertsCard.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        kpiAlertsCard.style.boxShadow = '0 0 15px rgba(239, 68, 68, 0.15)';
    } else if (current > (limit * 0.85)) {
        label.style.color = 'var(--accent-orange)';
        kpiAlertsCard.style.border = '1px solid rgba(249, 115, 22, 0.3)';
    } else {
        label.style.color = 'var(--text-secondary)';
        kpiAlertsCard.style.border = '1px solid var(--glass-border)';
        kpiAlertsCard.style.boxShadow = 'none';
    }
}

function renderCharts(data) {
    // 1. SERVICE BREAKDOWN CHART (DOUGHNUT)
    const serviceData = data.service_share;
    const serviceLabels = Object.keys(serviceData);
    const serviceValues = Object.values(serviceData);
    
    const serviceCtx = document.getElementById('serviceChart').getContext('2d');
    
    if (serviceChartInstance) {
        serviceChartInstance.data.labels = serviceLabels;
        serviceChartInstance.data.datasets[0].data = serviceValues;
        serviceChartInstance.update();
    } else {
        serviceChartInstance = new Chart(serviceCtx, {
            type: 'doughnut',
            data: {
                labels: serviceLabels,
                datasets: [{
                    data: serviceValues,
                    backgroundColor: [
                        '#3b82f6', // EC2 - Blue
                        '#f97316', // S3 - Orange
                        '#a855f7', // RDS - Purple
                        '#ec4899', // Redshift - Pink
                        '#10b981'  // Others - Green
                    ],
                    borderWidth: 1,
                    borderColor: 'rgba(255, 255, 255, 0.05)'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: '#94a3b8',
                            font: { family: 'Outfit', size: 11 },
                            padding: 15
                        }
                    }
                },
                cutout: '65%'
            }
        });
    }
    
    // 2. TREND CHART (STACKED LINE/BAR CHART SIMULATION)
    // Map backend history logs. In a live system, this pulls from Cost Explorer API
    const historical = data.historical;
    const months = historical.map(h => h.month);
    
    // Prepare datasets
    const services = ["EC2", "S3", "RDS", "Redshift", "Others"];
    const colors = {
        "EC2": '#3b82f6',
        "S3": '#f97316',
        "RDS": '#a855f7',
        "Redshift": '#ec4899',
        "Others": '#10b981'
    };
    
    // For July (current month), let's overlay the actual current spend values computed live
    const currentJuly = historical.find(h => h.month === "Jul") || { "month": "Jul" };
    // Adjust values to sync with our live calculated current figures
    const totalResource = data.current_spend;
    // Distribute current july values mathematically for display integrity
    currentJuly["RDS"] = data.service_share["RDS Databases"] || 320;
    currentJuly["Redshift"] = data.service_share["Redshift Clusters"] || 480;
    currentJuly["S3"] = data.service_share["S3 Storage"] || 156.4;
    currentJuly["EC2"] = data.service_share["EC2 Instances"] || 320;
    currentJuly["Others"] = data.service_share["CloudFront & Others"] || 110;
    
    const datasets = services.map(srv => {
        return {
            label: srv,
            data: historical.map(h => h[srv] || 0),
            borderColor: colors[srv],
            backgroundColor: colors[srv] + '1A', // transparent fill
            fill: true,
            tension: 0.3
        };
    });
    
    const trendCtx = document.getElementById('trendChart').getContext('2d');
    
    if (trendChartInstance) {
        trendChartInstance.data.labels = months;
        trendChartInstance.data.datasets = datasets;
        trendChartInstance.update();
    } else {
        trendChartInstance = new Chart(trendCtx, {
            type: 'line',
            data: {
                labels: months,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        stacked: true,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#94a3b8', font: { family: 'Outfit' } }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#94a3b8', font: { family: 'Outfit' } }
                    }
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            color: '#94a3b8',
                            font: { family: 'Outfit', size: 11 }
                        }
                    }
                }
            }
        });
    }
}

function renderAlerts(alerts) {
    const container = document.getElementById('alerts-log-container');
    container.innerHTML = '';
    
    if (!alerts || alerts.length === 0) {
        container.innerHTML = `
            <div style="text-align:center;color:var(--text-secondary);font-size:0.9rem;padding:20px;">
                No budget alerts. Spend limits normal.
            </div>
        `;
        return;
    }
    
    alerts.forEach(alert => {
        const item = document.createElement('div');
        item.className = `alert-item ${alert.severity}`;
        
        const isCritical = alert.severity === 'critical';
        const icon = isCritical 
            ? `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`
            : `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
            
        item.innerHTML = `
            <div class="alert-icon">${icon}</div>
            <div class="alert-body">
                <div>${alert.message}</div>
                <span class="alert-time">${alert.timestamp}</span>
            </div>
        `;
        container.appendChild(item);
    });
}

function renderRecommendations(recs) {
    const tableBody = document.getElementById('recommendations-table-body');
    const emptyState = document.getElementById('rec-empty-state');
    const leaksBadge = document.getElementById('leaks-badge-count');
    
    tableBody.innerHTML = '';
    leaksBadge.innerText = `${recs.length} Leaks Detected`;
    
    if (!recs || recs.length === 0) {
        document.querySelector('.rec-table').style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }
    
    document.querySelector('.rec-table').style.display = 'table';
    emptyState.style.display = 'none';
    
    recs.forEach(rec => {
        const row = document.createElement('tr');
        
        row.innerHTML = `
            <td>
                <span class="badge badge-${rec.category.toLowerCase()}">${rec.category}</span>
            </td>
            <td>
                <div style="font-weight:600;">${rec.name}</div>
                <div style="font-size:0.75rem;color:var(--text-secondary);">${rec.id}</div>
            </td>
            <td>
                <span style="font-size:0.85rem;color:var(--text-secondary);">${rec.region}</span>
            </td>
            <td>
                <span>$${rec.cost.toFixed(2)}/mo</span>
            </td>
            <td>
                <span style="color:var(--accent-orange);font-weight:600;font-size:0.85rem;">${rec.state}</span>
            </td>
            <td>
                <span class="saving-highlight">-$${rec.saving.toFixed(2)}/mo</span>
            </td>
            <td>
                <button class="btn-action" onclick="optimizeResource('${rec.category}', '${rec.id}')">${rec.action || 'Optimize'}</button>
            </td>
        `;
        tableBody.appendChild(row);
    });
}

// Budget management update call
async function updateBudgetLimit() {
    const budgetInput = document.getElementById('budget-input');
    const limit = parseFloat(budgetInput.value);
    
    if (isNaN(limit) || limit <= 0) {
        alert('Please enter a valid budget limit');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/costs/budget`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ budget: limit })
        });
        
        if (response.ok) {
            fetchDashboardData();
        } else {
            alert('Failed to update budget limit');
        }
    } catch (e) {
        console.error(e);
    }
}

// Optimize resource call
async function optimizeResource(category, id) {
    if (!confirm(`Are you sure you want to perform optimization action on this resource?`)) return;
    
    try {
        const response = await fetch(`${API_URL}/costs/optimize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category, id })
        });
        
        if (response.ok) {
            fetchDashboardData();
        } else {
            const data = await response.json();
            alert(data.message || 'Optimization failed');
        }
    } catch (e) {
        console.error(e);
    }
}

// Reset simulation call
async function resetSimulation() {
    if (!confirm('Are you sure you want to reset the simulation state? This will recreate the cost leak resources.')) return;
    
    try {
        const response = await fetch(`${API_URL}/costs/reset`, { method: 'POST' });
        if (response.ok) {
            fetchDashboardData();
        } else {
            alert('Reset failed');
        }
    } catch (e) {
        console.error(e);
    }
}
