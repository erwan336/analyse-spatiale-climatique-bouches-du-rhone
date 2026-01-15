#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script de traitement des donnees meteorologiques avec generation de carte
Departement 13 - Bouches-du-Rhone
"""

import pandas as pd
import json
from datetime import datetime
import os

def load_meteo_data(csv_file):
    """Charge et nettoie les donnees meteorologiques"""
    print(f"Chargement du fichier : {csv_file}")
    
    if not os.path.exists(csv_file):
        print(f"ERREUR: Le fichier {csv_file} n'existe pas!")
        return None
    
    df = pd.read_csv(csv_file, sep=';', dtype={'NUM_POSTE': str, 'AAAAMMJJ': str})
    print(f"Nombre total de lignes : {len(df)}")
    print(f"Nombre de communes : {df['NOM_USUEL'].nunique()}")
    return df

def convert_date(date_str):
    """Convertit AAAAMMJJ en format lisible"""
    try:
        date_obj = datetime.strptime(str(date_str), '%Y%m%d')
        return date_obj.strftime('%d/%m/%Y')
    except:
        return date_str

def process_commune_data(df):
    """Traite les donnees par commune avec coordonnees GPS"""
    communes_data = {}
    
    for nom_commune in df['NOM_USUEL'].unique():
        commune_df = df[df['NOM_USUEL'] == nom_commune].copy()
        commune_df['DATE'] = commune_df['AAAAMMJJ'].apply(convert_date)
        commune_df = commune_df.sort_values('AAAAMMJJ')
        
        lat = float(commune_df['LAT'].iloc[0])
        lon = float(commune_df['LON'].iloc[0])
        
        commune_info = {
            'nom': nom_commune,
            'num_poste': commune_df['NUM_POSTE'].iloc[0],
            'latitude': lat,
            'longitude': lon,
            'altitude': int(commune_df['ALTI'].iloc[0]),
            'coordinates': [lon, lat],
            'donnees': []
        }
        
        for _, row in commune_df.iterrows():
            jour_data = {
                'date': row['DATE'],
                'date_raw': row['AAAAMMJJ'],
                'precipitation': float(row['RR']) if pd.notna(row['RR']) else 0,
                'temp_min': float(row['TN']) if pd.notna(row['TN']) else None,
                'temp_max': float(row['TX']) if pd.notna(row['TX']) else None,
                'temp_moy': float(row['TM']) if pd.notna(row['TM']) else None,
                'vent_moy': float(row['FFM']) if pd.notna(row['FFM']) else None,
                'vent_max': float(row['FXI']) if pd.notna(row['FXI']) else None,
            }
            commune_info['donnees'].append(jour_data)
        
        communes_data[nom_commune] = commune_info
    
    return communes_data

def calculate_statistics(communes_data):
    """Calcule des statistiques globales"""
    stats = {
        'nb_communes': len(communes_data),
        'date_debut': None,
        'date_fin': None,
        'temp_max_globale': -100,
        'temp_min_globale': 100,
        'precip_max': 0,
        'commune_temp_max': '',
        'commune_temp_min': '',
        'commune_precip_max': ''
    }
    
    all_dates = []
    
    for nom_commune, data in communes_data.items():
        for jour in data['donnees']:
            all_dates.append(jour['date_raw'])
            
            if jour['temp_max'] and jour['temp_max'] > stats['temp_max_globale']:
                stats['temp_max_globale'] = jour['temp_max']
                stats['commune_temp_max'] = nom_commune
            
            if jour['temp_min'] and jour['temp_min'] < stats['temp_min_globale']:
                stats['temp_min_globale'] = jour['temp_min']
                stats['commune_temp_min'] = nom_commune
            
            if jour['precipitation'] > stats['precip_max']:
                stats['precip_max'] = jour['precipitation']
                stats['commune_precip_max'] = nom_commune
    
    if all_dates:
        all_dates.sort()
        stats['date_debut'] = convert_date(all_dates[0])
        stats['date_fin'] = convert_date(all_dates[-1])
    
    return stats

def create_geojson_features(communes_data):
    """Cree des features GeoJSON pour les communes"""
    features = []
    
    for nom_commune, data in communes_data.items():
        temp_values = [j['temp_moy'] for j in data['donnees'] if j['temp_moy'] is not None]
        temp_moy_commune = sum(temp_values) / len(temp_values) if temp_values else 0
        precip_total = sum([j['precipitation'] for j in data['donnees']])
        
        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": data['coordinates']
            },
            "properties": {
                "nom": nom_commune,
                "num_poste": data['num_poste'],
                "altitude": data['altitude'],
                "temp_moyenne": round(temp_moy_commune, 1),
                "precip_totale": round(precip_total, 1),
                "latitude": data['latitude'],
                "longitude": data['longitude']
            }
        }
        features.append(feature)
    
    return features

def calculate_bounds(communes_data):
    """Calcule les limites geographiques du departement"""
    lats = [data['latitude'] for data in communes_data.values()]
    lons = [data['longitude'] for data in communes_data.values()]
    
    return {
        'min_lat': min(lats),
        'max_lat': max(lats),
        'min_lon': min(lons),
        'max_lon': max(lons),
        'center_lat': sum(lats) / len(lats),
        'center_lon': sum(lons) / len(lons)
    }

def save_json(data, output_file):
    """Sauvegarde les donnees en JSON"""
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"Fichier JSON cree : {output_file}")

def main():
    # Chemin direct vers le fichier CSV depuis la racine
    input_file = 'data/raw/Q_13_latest-2025-2026_RR-T-Vent.csv'
    output_file = 'web/meteo_data.json'
    
    print("="*70)
    print("TRAITEMENT DES DONNEES METEOROLOGIQUES - DEPARTEMENT 13")
    print("="*70)
    print(f"Repertoire de travail : {os.getcwd()}")
    
    # Verifier que le fichier existe
    if not os.path.exists(input_file):
        print(f"\nERREUR: Fichier introuvable : {input_file}")
        print("\nVerification des fichiers disponibles...")
        if os.path.exists('data/raw'):
            print("Fichiers dans data/raw :")
            for f in os.listdir('data/raw'):
                print(f"  - {f}")
        return
    
    df = load_meteo_data(input_file)
    if df is None:
        return
    
    print("\nTraitement des donnees par commune...")
    communes_data = process_commune_data(df)
    print(f"Nombre de communes traitees : {len(communes_data)}")
    
    print("\nCalcul des statistiques...")
    stats = calculate_statistics(communes_data)
    
    print("\nCreation des donnees cartographiques...")
    geojson_features = create_geojson_features(communes_data)
    
    bounds = calculate_bounds(communes_data)
    print(f"Centre du departement : {bounds['center_lat']:.4f}N, {bounds['center_lon']:.4f}E")
    
    output_data = {
        'metadata': {
            'departement': '13',
            'nom_departement': 'Bouches-du-Rhone',
            'date_generation': datetime.now().strftime('%d/%m/%Y %H:%M:%S'),
            'statistiques': stats,
            'bounds': bounds
        },
        'communes': communes_data,
        'geojson': {
            'type': 'FeatureCollection',
            'features': geojson_features
        }
    }
    
    # Creer le dossier web s'il n'existe pas
    os.makedirs('web', exist_ok=True)
    
    save_json(output_data, output_file)
    
    print("\n" + "="*70)
    print("RESUME DES DONNEES")
    print("="*70)
    print(f"Nombre de communes      : {stats['nb_communes']}")
    print(f"Periode                 : du {stats['date_debut']} au {stats['date_fin']}")
    print(f"Temperature maximale    : {stats['temp_max_globale']}C ({stats['commune_temp_max']})")
    print(f"Temperature minimale    : {stats['temp_min_globale']}C ({stats['commune_temp_min']})")
    print(f"Precipitation maximale  : {stats['precip_max']} mm ({stats['commune_precip_max']})")
    print(f"Centre geographique     : {bounds['center_lat']:.4f}N, {bounds['center_lon']:.4f}E")
    print("="*70)
    
    print("\nCOMMUNES DISPONIBLES:")
    print("-" * 70)
    for i, (nom, data) in enumerate(sorted(communes_data.items()), 1):
        print(f"{i:2d}. {nom:30s} - Alt: {data['altitude']:4d}m")
    print("-" * 70)
    
    print(f"\nFichier JSON genere : {output_file}")
    print("\nETAPE SUIVANTE:")
    print("1. Ouvrez web/index.html dans votre navigateur")
    print("2. Le fichier meteo_data.json a ete cree dans le dossier web/")

if __name__ == "__main__":
    main()