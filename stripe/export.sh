#!/bin/bash

# Create exports directory if it doesn't exist
cd stripe
mkdir -p exports

# Export Stripe products to JSON file in exports folder
echo "Exporting Stripe products to stripe/exports/products.json..."
stripe products list --limit 100 > "exports/products.json"

# Export Stripe prices to JSON file in exports folder
echo "Exporting Stripe prices to stripe/exports/prices.json..."
stripe prices list --limit 100 > "exports/prices.json"

echo "Export completed! Files saved in the 'stripe/exports' folder:"
echo "- exports/products.json"
echo "- exports/prices.json"
