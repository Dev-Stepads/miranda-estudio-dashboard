'use client';

import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps';
import { useState } from 'react';

interface StateData {
  state: string;
  revenue: number;
  orders_count: number;
}

interface BrazilMapProps {
  data: StateData[];
}

const NAME_TO_UF: Record<string, string> = {
  'Acre': 'AC', 'Alagoas': 'AL', 'Amapá': 'AP', 'Amazonas': 'AM',
  'Bahia': 'BA', 'Ceará': 'CE', 'Distrito Federal': 'DF',
  'Espírito Santo': 'ES', 'Goiás': 'GO', 'Maranhão': 'MA',
  'Mato Grosso': 'MT', 'Mato Grosso do Sul': 'MS', 'Minas Gerais': 'MG',
  'Pará': 'PA', 'Paraíba': 'PB', 'Paraná': 'PR', 'Pernambuco': 'PE',
  'Piauí': 'PI', 'Rio de Janeiro': 'RJ', 'Rio Grande do Norte': 'RN',
  'Rio Grande do Sul': 'RS', 'Rondônia': 'RO', 'Roraima': 'RR',
  'Santa Catarina': 'SC', 'São Paulo': 'SP', 'Sergipe': 'SE',
  'Tocantins': 'TO',
};

function getColor(value: number, max: number): string {
  if (value === 0 || max === 0) return '#e2e8f0';
  const ratio = value / max;
  if (ratio > 0.7) return '#6d28d9';
  if (ratio > 0.4) return '#8b5cf6';
  if (ratio > 0.2) return '#a78bfa';
  if (ratio > 0.05) return '#c4b5fd';
  return '#ddd6fe';
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

export function BrazilMap({ data }: BrazilMapProps) {
  const [tooltip, setTooltip] = useState<{ name: string; revenue: number; orders: number } | null>(null);

  const dataMap = new Map(data.map(d => [d.state, d]));
  const maxRevenue = Math.max(...data.map(d => d.revenue), 1);
  const ranked = [...data].sort((a, b) => b.revenue - a.revenue).slice(0, 15);

  return (
    <div className="rounded-xl bg-white dark:bg-gray-800 p-4 sm:p-6 shadow-sm border border-gray-100 dark:border-gray-700">
      <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
        Compradores por Estado
      </h3>

      {/* Map */}
      <div className="relative h-56 sm:h-72">
        <ComposableMap
          projection="geoMercator"
          projectionConfig={{ scale: 550, center: [-54, -15] }}
          width={500}
          height={400}
          style={{ width: '100%', height: '100%' }}
        >
          <ZoomableGroup>
            <Geographies geography="/brazil-states.geojson">
              {({ geographies }) =>
                geographies.map((geo) => {
                  const stateName = geo.properties.name as string;
                  const uf = NAME_TO_UF[stateName] ?? '';
                  const stateData = dataMap.get(uf);
                  const revenue = stateData?.revenue ?? 0;
                  const orders = stateData?.orders_count ?? 0;

                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill={getColor(revenue, maxRevenue)}
                      stroke="#fff"
                      strokeWidth={0.5}
                      style={{
                        default: { outline: 'none' },
                        hover: { outline: 'none', fill: '#4c1d95', cursor: 'pointer' },
                        pressed: { outline: 'none' },
                      }}
                      onMouseEnter={() => setTooltip({ name: `${stateName} (${uf})`, revenue, orders })}
                      onMouseLeave={() => setTooltip(null)}
                    />
                  );
                })
              }
            </Geographies>
          </ZoomableGroup>
        </ComposableMap>

        {tooltip && (
          <div className="absolute top-2 right-2 bg-white dark:bg-gray-700 rounded-lg shadow-lg p-3 text-xs border border-gray-200 dark:border-gray-600 pointer-events-none">
            <p className="font-semibold text-gray-900 dark:text-gray-100">{tooltip.name}</p>
            <p className="text-gray-600 dark:text-gray-300 mt-1">{formatBRL(tooltip.revenue)}</p>
            <p className="text-gray-500 dark:text-gray-400">{tooltip.orders} pedidos</p>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-3 mb-4 text-sm text-gray-500 dark:text-gray-400 justify-center">
        <span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#ddd6fe' }} />
        <span>Baixo</span>
        <span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#a78bfa' }} />
        <span>Médio</span>
        <span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#6d28d9' }} />
        <span>Alto</span>
      </div>

      {/* Ranking table */}
      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Ranking por Faturamento</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th className="py-2 text-left font-medium text-gray-500 dark:text-gray-400">Estado</th>
              <th className="py-2 text-right font-medium text-gray-500 dark:text-gray-400">Pedidos</th>
              <th className="py-2 text-right font-medium text-gray-500 dark:text-gray-400">Faturamento</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((s) => (
              <tr key={s.state} className="border-b border-gray-50 dark:border-gray-700/50">
                <td className="py-2.5">
                  <span className="inline-block w-3 h-3 rounded-sm mr-2 align-middle" style={{ background: getColor(s.revenue, maxRevenue) }} />
                  <span className="font-medium text-gray-800 dark:text-gray-200">{s.state}</span>
                </td>
                <td className="py-2.5 text-right text-gray-600 dark:text-gray-300 font-mono">
                  {s.orders_count.toLocaleString('pt-BR')}
                </td>
                <td className="py-2.5 text-right font-semibold text-gray-900 dark:text-gray-100">
                  {formatBRL(s.revenue)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
