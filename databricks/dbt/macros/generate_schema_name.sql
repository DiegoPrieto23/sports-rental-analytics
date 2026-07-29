{#
    Por defecto dbt concatena el schema del profile con el schema del modelo
    (target_schema + "_" + custom_schema), lo que produciria nombres como
    `staging_intermediate`. Aqui forzamos el nombre literal para que las capas
    aterricen exactamente en los schemas `staging`, `intermediate` y `marts`.
#}
{% macro generate_schema_name(custom_schema_name, node) -%}
    {%- if custom_schema_name is none -%}
        {{ target.schema }}
    {%- else -%}
        {{ custom_schema_name | trim }}
    {%- endif -%}
{%- endmacro %}
