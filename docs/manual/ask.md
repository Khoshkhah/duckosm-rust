# Ask and query the data

!!! note
    Ask and the data dock are not on the live page yet. They come with the next update of the page.

After a build, you can look at the tables in the page. You do not have to download a file. There are two ways:

- **Query the tables** (card 5) opens the data dock under the map. You write SQL, and the page runs it on the tables of this build.
- **Ask the data** (the card after step 6) opens Ask in the panel. You write a question in words, and an AI service writes the SQL for you.

In both ways, the roads of the result light on the map.

## Query the tables

1. Build an area (step 4).
2. In card 5, click **Query the tables**. The data dock opens under the map, with an example query: the number of edges and the km of each road class.
3. Click the SQL line, write your query, and press **Ctrl+Enter** (or click **Run**).

Write the name of a table with its network, for example `driving.edges` or `walking.nodes`. [The tables](tables.md) tells what each table holds. **Tables** in the dock lists all the tables with their number of rows. A click on a table shows its rows.

```sql
-- the one-way roads that have no name
SELECT edge_id, highway, length_m FROM driving.edges WHERE oneway AND name IS NULL;
```

Only one `SELECT` or `WITH` statement runs. The dock refuses a statement that changes the tables or reads a file.

| Part of the dock | What it does |
|---|---|
| The table | Shows the first 1,000 rows. A click on a header sorts all the rows. |
| **CSV** | Downloads all the rows (at most 1,000,000). |
| A row | Selects its road on the map and zooms to it. The road's card shows beside the table. |
| **Light** | The roads of the table light on the map. Click it to turn the light off and on. |
| **Table \| Chart** | Shows the result as a chart: a bar, a pie, a line, a histogram or a scatter. **SVG** downloads the chart. |
| **Colour ▾** | Gives the roads of the table a colour, one colour for each value of a text column (for example `highway`). |
| **Focus ▾** | Keeps the roads of the table, and the other roads fade or hide. |

A colour and a focus stay on the map until you turn them off in their list.

## Ask the data

Ask is an AI agent. It writes the SQL, runs it in the data dock, reads the result and answers in one to three sentences.

1. Get a free key from an AI service, for example [Google Gemini](https://aistudio.google.com/apikey) or [Groq](https://console.groq.com/keys).
2. Click the card **Ask the data**.
3. Click **Key**, select the service, paste the key and click **Save**. The page says "The key works", or it shows the service's error.
4. Write a question, for example "Which primary roads are longer than 300 m?", and press **Enter**. You can also click one of the example questions.

Each answer is a card. The card shows the question, the answer and the number of queries. Open the queries to see the SQL. **Show** puts the answer's table in the data dock again, and its roads light on the map. An answer can also colour roads, focus on roads or move the map.

**New** starts a new conversation. The map keeps its colours and its focus.

### Your key and your data

- The key stays in your browser. The page sends it only to the service that you selected.
- Other pages on the same address (`khoshkhah.github.io`) can read the key. Use a key with a spending limit. **Clear** in the key form removes the key.
- Ask sends your question, the conversation, the names of the tables and columns, and some rows of each result (at most 30) to the AI service. The tables of your build stay in your browser.
- An AI service can be wrong. Look at the table and at the SQL.

If the service is busy, Ask waits and tries again. If it is still busy, the card says so. Try again in a minute, or select another service under **Key**.

## Next

- [The tables](tables.md) and [Columns of the tables](../output-tables.md) tell what each column holds.
- To use the tables in your own tools, download the **.duckdb** file ([step 5](result.md#the-downloads)).
