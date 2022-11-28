import fs from 'node:fs/promises'

import delay from 'delay'
import makeDir from 'make-dir'
import pMap from 'p-map'

import * as config from './lib/config'
import * as types from './types'
import { getOMDBMovieByIMDBID, loadOMDBMoviesFromCache } from './lib/omdb'

/**
 * Fetches info on all previously downloaded movies from OMDB by IMDB ID.
 *
 * @example
 * ```
 * npx tsx src/populate-omdb-movies.ts
 * IGNORE_EXISTING_OMDB_MOVIES=true npx tsx src/populate-omdb-movies.ts
 * ```
 */
async function main() {
  const ignoreExistingOMDBMovies = !!process.env.IGNORE_EXISTING_OMDB_MOVIES
  await makeDir(config.outDir)

  const omdbMovies = await loadOMDBMoviesFromCache()

  let batchNum = 0
  let numMoviesTotal = 0
  let numOMDBMoviesDownloadedTotal = 0

  do {
    const srcFile = `${config.outDir}/movies-${batchNum}.json`
    const movies: types.Movie[] = JSON.parse(
      await fs.readFile(srcFile, { encoding: 'utf-8' })
    )

    console.warn(
      `\npopulating ${movies.length} movies in batch ${batchNum} (${srcFile})\n`
    )

    let firstMovieInBatch = true
    const omdbOutputMovies = (
      await pMap(
        movies,
        async (movie, index): Promise<Partial<types.omdb.Movie> | null> => {
          if (!movie.imdbId) {
            return null
          }

          if (!ignoreExistingOMDBMovies && omdbMovies[movie.tmdbId]) {
            return null
          }

          let numErrors = 0

          while (true) {
            try {
              console.warn(
                `${batchNum}:${index} omdb ${movie.id} ${movie.imdbId} (${movie.releaseYear}) ${movie.title}`
              )

              const omdbMovie = await getOMDBMovieByIMDBID(movie.imdbId, {
                rt: true
              })
              const result = (omdbMovies[movie.tmdbId] = {
                ...omdbMovies[movie.tmdbId],
                ...omdbMovie
              })

              if (firstMovieInBatch) {
                firstMovieInBatch = false
                // console.warn()
                // console.warn(JSON.stringify(result, null, 2))
                // console.warn()
              }
              console.log(JSON.stringify(result, null, 2))

              return result
            } catch (err) {
              console.error(
                'omdb error',
                movie.id,
                movie.imdbId,
                movie.title,
                err.toString()
              )

              if (
                err.response?.statusCode >= 400 &&
                err.response?.statusCode < 500
              ) {
                // unrecoverable error
                return null
              } else if (++numErrors >= 3) {
                return null
              } else {
                await delay(10000 + 1000 * numErrors * numErrors)
              }
            }
          }
        },
        {
          concurrency: 4
        }
      )
    ).filter(Boolean)

    const numMovies = movies.length
    const numOMDBMoviesDownloaded = omdbOutputMovies.length

    numMoviesTotal += numMovies
    numOMDBMoviesDownloadedTotal += numOMDBMoviesDownloaded

    console.warn()
    console.warn(`batch ${batchNum} done`, {
      numMovies,
      numOMDBMoviesDownloaded,
      numOMDBMoviesTotal: Object.keys(omdbMovies).length
    })

    await fs.writeFile(
      config.omdbMoviesPath,
      JSON.stringify(omdbMovies, null, 2),
      {
        encoding: 'utf-8'
      }
    )

    ++batchNum
  } while (batchNum < config.numBatches)

  console.warn()
  console.warn('done', {
    numMoviesTotal,
    numOMDBMoviesDownloadedTotal,
    numOMDBMoviesTotal: Object.keys(omdbMovies).length
  })
}

main()
