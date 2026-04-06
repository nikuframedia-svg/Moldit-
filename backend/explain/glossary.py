"""Glossary — prohibited technical terms → plain Portuguese.

Rule: if a term appears in PROHIBITED, it must NEVER appear in the UI.
Use the Portuguese equivalent from GLOSSARY instead.
"""

PROHIBITED = {
    "makespan", "compliance", "OTD", "KPI", "DAG", "SHAP",
    "Monte Carlo", "XGBoost", "Random Forest", "Isolation Forest",
    "LightGBM", "quantile regression", "feature importance",
    "confidence interval", "cold start", "retrain", "AUC",
    "ROC", "MAE", "RMSE", "nDCG", "F1", "throughput",
    "bottleneck", "slack", "float", "critical path",
    "utilization", "balance", "setup", "chromosome",
    "CPO", "VNS", "ATCS", "LHS",
}

GLOSSARY = {
    "makespan": "tempo total de producao",
    "compliance": "cumprimento de prazos",
    "OTD": "prazos cumpridos",
    "KPI": "indicador",
    "setups": "trocas de trabalho",
    "setup": "troca de trabalho",
    "utilization": "utilizacao",
    "utilization_balance": "distribuicao de carga",
    "balance": "equilibrio de carga",
    "slack": "folga",
    "float": "margem de manobra",
    "critical_path": "caminho mais longo",
    "bottleneck": "maquina mais sobrecarregada",
    "throughput": "capacidade de producao",
    "DAG": "ordem das operacoes",
    "SHAP": "fatores que influenciam a previsao",
    "Monte Carlo": "simulacao de cenarios",
    "XGBoost": "modelo de previsao",
    "Random Forest": "modelo de previsao",
    "feature importance": "fatores mais importantes",
    "confidence interval": "intervalo de confianca",
    "cold start": "arranque sem dados",
    "retrain": "atualizacao das previsoes",
    "AUC": "capacidade de previsao",
    "MAE": "erro medio",
}
